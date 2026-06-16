/**
 * cloudflare-tunnel.ts — Named Cloudflare Tunnel per user
 *
 * Each clawd.run user gets a stable subdomain: agent-{shortId}.clawd.run
 * Tunnel is created once on first provision, credentials stored in Firestore.
 * On reprovision: reuse existing tunnel credentials (URL never changes).
 */

const CF_API = "https://api.cloudflare.com/client/v4";
const CF_TOKEN   = process.env.CF_TUNNEL_TOKEN;    // API Token (Bearer)
const CF_EMAIL   = process.env.CF_EMAIL;           // Global API Key auth: email
const CF_API_KEY = process.env.CF_API_KEY;         // Global API Key auth: key
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID!;
const CF_ZONE    = process.env.CF_ZONE_ID!;
const BASE_DOMAIN = "clawd.run";

function cfHeaders(): Record<string, string> {
  // Prefer API Token (Bearer) — more reliable, scoped correctly
  if (CF_TOKEN) {
    return {
      "Authorization": `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
    };
  }
  // Fall back to Global API Key
  if (CF_EMAIL && CF_API_KEY) {
    return {
      "X-Auth-Email": CF_EMAIL,
      "X-Auth-Key": CF_API_KEY,
      "Content-Type": "application/json",
    };
  }
  return { "Content-Type": "application/json" };
}

export interface TunnelInfo {
  tunnelId: string;
  tunnelToken: string;       // used to run cloudflared in sandbox
  subdomain: string;         // e.g. "agent-kc0sgkja"
  url: string;               // e.g. "https://agent-kc0sgkja.clawd.run"
}

/** Derive stable subdomain from userId */
function subdomainFor(userId: string): string {
  return `agent-${userId.substring(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** Create a named tunnel + DNS record for a user. Idempotent -- returns existing if already exists. */
export async function ensureTunnel(
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<TunnelInfo> {
  // Check Firestore for existing tunnel
  const userDoc = await db.collection("users").doc(userId).get();
  const existing = userDoc.data()?.cfTunnel as TunnelInfo | undefined;
  if (existing?.tunnelId && existing?.tunnelToken) {
    return existing;
  }

  const subdomain = subdomainFor(userId);
  const tunnelName = `clawd-${userId.substring(0, 12).toLowerCase()}`;

  // Create tunnel
  const createRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel`, {
    method: "POST",
    headers: cfHeaders(),
    body: JSON.stringify({ name: tunnelName, config_src: "cloudflare" }),
  });
  const createData = await createRes.json() as { success: boolean; result?: { id: string }; errors?: unknown[] };
  if (!createData.success) {
    throw new Error(`Failed to create CF tunnel: ${JSON.stringify(createData.errors)}`);
  }
  const tunnelId = createData.result!.id;

  // Get tunnel run token
  const tokenRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${tunnelId}/token`, {
    headers: cfHeaders(),
  });
  const tokenData = await tokenRes.json() as { success: boolean; result?: string };
  if (!tokenData.success || !tokenData.result) {
    throw new Error("Failed to get tunnel token");
  }
  const tunnelToken = tokenData.result;

  // Configure tunnel ingress: all traffic → localhost:8401 (clawd.run wrapper)
  await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${tunnelId}/configurations`, {
    method: "PUT",
    headers: cfHeaders(),
    body: JSON.stringify({
      config: {
        ingress: [
          { hostname: `${subdomain}.${BASE_DOMAIN}`, service: "http://localhost:8401" },  // gateway direct
          { service: "http_status:404" },
        ],
      },
    }),
  });

  // Create DNS CNAME record
  const dnsRes = await fetch(`${CF_API}/zones/${CF_ZONE}/dns_records`, {
    method: "POST",
    headers: cfHeaders(),
    body: JSON.stringify({
      type: "CNAME",
      name: subdomain,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
    }),
  });
  const dnsData = await dnsRes.json() as { success: boolean; errors?: unknown[] };
  if (!dnsData.success) {
    // DNS record might already exist -- not fatal
    console.warn("[CF Tunnel] DNS record creation failed (may already exist):", dnsData.errors);
  }

  const info: TunnelInfo = {
    tunnelId,
    tunnelToken,
    subdomain,
    url: `https://${subdomain}.${BASE_DOMAIN}`,
  };

  // Store in Firestore (tunnelToken is sensitive but we need it for reprovisioning)
  await db.collection("users").doc(userId).update({ cfTunnel: info });

  console.log(`[CF Tunnel] Created ${info.url} (tunnel: ${tunnelId})`);
  return info;
}


/** Update the tunnel's ingress to point to the sandbox's actual LAN IP.
 * cloudflared inside the sandbox connects to this URL — must use LAN IP, not localhost,
 * because the gateway binds to LAN interface (--bind lan/auto), not loopback.
 */
export async function updateTunnelIngress(
  tunnelId: string,
  serviceUrlOrIp: string,  // full URL (e.g. https://daytonaproxy URL) or legacy LAN IP
  subdomain: string,
  port = 8401
): Promise<void> {
  // Use the LAN IP passed in (gateway binds to LAN interface)
  const serviceUrl = serviceUrlOrIp.startsWith("http")
    ? serviceUrlOrIp
    : `http://${serviceUrlOrIp}:${port}`;
  await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${tunnelId}/configurations`, {
    method: "PUT",
    headers: cfHeaders(),
    body: JSON.stringify({
      config: {
        ingress: [
          { hostname: `${subdomain}.${BASE_DOMAIN}`, service: serviceUrl },
          { service: "http_status:404" },
        ],
      },
    }),
  });
  console.log(`[CF Tunnel] Ingress updated: ${subdomain}.${BASE_DOMAIN} → ${serviceUrl}`);
}

/** Rotate the CF tunnel: delete old tunnel, create new one with same subdomain.
 * Old cloudflared instances use old token → can't reconnect after rotation.
 * Call on every reprovision to prevent stale connection accumulation.
 */
export async function rotateTunnel(
  db: FirebaseFirestore.Firestore,
  userId: string,
  existingTunnel: TunnelInfo
): Promise<TunnelInfo> {
  const subdomain = existingTunnel.subdomain;
  const tunnelName = `clawd-${userId.substring(0, 12).toLowerCase()}`;

  // Delete old tunnel (also removes all active connections)
  try {
    await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${existingTunnel.tunnelId}?cascade=true`, {
      method: "DELETE",
      headers: cfHeaders(),
    });
    console.log(`[CF Tunnel] Deleted old tunnel ${existingTunnel.tunnelId}`);
  } catch (e) {
    console.warn("[CF Tunnel] Failed to delete old tunnel (continuing):", e);
  }

  // Create new tunnel
  const createRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel`, {
    method: "POST",
    headers: cfHeaders(),
    body: JSON.stringify({ name: tunnelName, config_src: "cloudflare" }),
  });
  const createData = await createRes.json() as { success: boolean; result?: { id: string }; errors?: unknown[] };
  if (!createData.success) {
    throw new Error(`Failed to create new CF tunnel: ${JSON.stringify(createData.errors)}`);
  }
  const newTunnelId = createData.result!.id;

  // Get new token
  const tokenRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${newTunnelId}/token`, {
    headers: cfHeaders(),
  });
  const tokenData = await tokenRes.json() as { success: boolean; result?: string };
  if (!tokenData.success || !tokenData.result) {
    throw new Error("Failed to get new tunnel token");
  }
  const newToken = tokenData.result;

  // Update DNS CNAME to new tunnel ID
  // Delete old CNAME and create new one
  try {
    const listRes = await fetch(`${CF_API}/zones/${CF_ZONE}/dns_records?type=CNAME&name=${subdomain}.${BASE_DOMAIN}`, {
      headers: cfHeaders(),
    });
    const listData = await listRes.json() as { result?: { id: string }[] };
    for (const rec of listData.result ?? []) {
      await fetch(`${CF_API}/zones/${CF_ZONE}/dns_records/${rec.id}`, {
        method: "PATCH",
        headers: cfHeaders(),
        body: JSON.stringify({ content: `${newTunnelId}.cfargotunnel.com` }),
      });
    }
  } catch (e) {
    console.warn("[CF Tunnel] DNS update failed:", e);
  }

  const info: TunnelInfo = {
    tunnelId: newTunnelId,
    tunnelToken: newToken,
    subdomain,
    url: `https://${subdomain}.${BASE_DOMAIN}`,
  };

  // Store in Firestore
  await db.collection("users").doc(userId).update({ cfTunnel: info });
  console.log(`[CF Tunnel] Rotated tunnel → ${newTunnelId}`);
  return info;
}
// tunnel fix: force rebuild with updated CF_TUNNEL_TOKEN env var
