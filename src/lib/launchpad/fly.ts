/**
 * Launchpad Fly.io provisioner.
 *
 * Architecture
 * ------------
 * The Hermes/OpenClaw *dashboard* runs on Fly Machines (one app per user,
 * one machine per app). Fly's L4-aware proxy supports WebSockets natively,
 * which Daytona's HTTP-only proxy does not — that's the entire reason for
 * this module's existence.
 *
 * The agent's *terminal backend* is still Daytona (see
 * `launchpad-images/hermes/start.fly.sh` writing `terminal.backend: daytona`
 * into config.yaml). All shell commands, code execution, file edits — those
 * happen inside an ephemeral Daytona workspace, which is exactly what
 * Daytona is designed for. The $20k Daytona credit pool burns there, only
 * while commands are running.
 *
 * App naming: deterministic neutral codenames derived from user+product.
 * URL: https://lp-<codename>.fly.dev (later CNAMEd to *.clawd.run)
 *
 * Auto-suspend: machines pause when idle (~300ms wake on next request),
 * costing $0 compute while suspended. See fly.toml `auto_stop_machines`.
 */

import { createHash } from "crypto";
import { LaunchpadProduct } from "@/lib/launchpad/plans";

const FLY_API = "https://api.machines.dev/v1";

// Network name used for machines. Default per-app network gives each app
// its own isolated 6PN namespace which is what we want.
const FLY_NETWORK = "default";

const FLY_REGION = process.env.FLY_REGION || "iad";

function flyToken(): string {
  const t = process.env.FLY_API_TOKEN;
  if (!t) throw new Error("FLY_API_TOKEN not configured");
  return t;
}

function flyOrg(): string {
  return process.env.FLY_ORG_SLUG || "personal";
}

function flyHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${flyToken()}`,
    "Content-Type": "application/json",
  };
}

async function flyFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${FLY_API}${path}`, {
    ...init,
    headers: { ...flyHeaders(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Fly API ${init.method || "GET"} ${path} -> ${res.status}: ${body}`
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bring a machine to "started", tolerating Fly's async replace cycle.
 *
 * Updating a machine's image makes Fly *replace* it; calling /start during
 * that window returns 412 "machine getting replaced". We poll the state and
 * only issue /start once the machine is in a stable stopped/suspended state,
 * retrying a bounded number of times. A machine still replacing when we give
 * up is fine — Fly finishes the replace and `autostart` brings it up on the
 * first inbound request.
 */
async function ensureMachineStarted(
  appName: string,
  machineId: string
): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    let state = "";
    try {
      const m = await flyFetch<FlyMachine>(
        `/apps/${appName}/machines/${machineId}`
      );
      state = m.state || "";
    } catch {
      // transient read error during replace — back off and retry
    }
    if (state === "started") return;
    if (state === "stopped" || state === "suspended") {
      try {
        await flyFetch<unknown>(
          `/apps/${appName}/machines/${machineId}/start`,
          { method: "POST" }
        );
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 412 = mid-replace; keep waiting. Anything else is a real failure.
        if (!/->\s*412|getting replaced/.test(msg)) throw err;
      }
    }
    await sleep(2500);
  }
  console.warn(
    `[launchpad/fly] ${appName}/${machineId} not started in time; ` +
      `relying on Fly autostart on first request`
  );
}

const CODE_ADJECTIVES = [
  "amber",
  "cedar",
  "dawn",
  "ember",
  "frost",
  "glint",
  "harbor",
  "ivory",
  "juniper",
  "kepler",
  "lumen",
  "mistral",
  "nova",
  "onyx",
  "prism",
  "quartz",
  "rivet",
  "solace",
  "tidal",
  "velvet",
];

const CODE_NOUNS = [
  "anchor",
  "beacon",
  "cipher",
  "drift",
  "ember",
  "forge",
  "grove",
  "haven",
  "isle",
  "junction",
  "kernel",
  "ledger",
  "meadow",
  "nexus",
  "orbit",
  "pilot",
  "quill",
  "relay",
  "signal",
  "vertex",
];

function nameHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function codenameFor(userId: string, product: LaunchpadProduct): string {
  const hash = nameHash(`lp-codename:${userId}:${product}`);
  const a = parseInt(hash.slice(0, 8), 16) % CODE_ADJECTIVES.length;
  const n = parseInt(hash.slice(8, 16), 16) % CODE_NOUNS.length;
  const suffix = hash.slice(16, 24);
  return `${CODE_ADJECTIVES[a]}-${CODE_NOUNS[n]}-${suffix}`;
}

function appNameFor(userId: string, product: LaunchpadProduct): string {
  return `lp-${codenameFor(userId, product)}`;
}

function legacyAppNameFor(userId: string, product: LaunchpadProduct): string {
  const tail = userId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `lp-${product}-${tail}`;
}

async function appExists(name: string): Promise<boolean> {
  try {
    await flyFetch<FlyApp>(`/apps/${name}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/->\s*404/.test(msg)) return false;
    throw err;
  }
}

async function resolveAppName(
  userId: string,
  product: LaunchpadProduct
): Promise<string> {
  const preferred = appNameFor(userId, product);
  if (await appExists(preferred)) return preferred;
  const legacy = legacyAppNameFor(userId, product);
  if (await appExists(legacy)) return legacy;
  return preferred;
}

export function imageFor(product: LaunchpadProduct): string {
  if (product === "hermes") {
    return (
      process.env.LAUNCHPAD_HERMES_IMAGE ||
      "joeproai/launchpad-hermes:0.14.17-fly"
    );
  }
  return (
    process.env.LAUNCHPAD_OPENCLAW_IMAGE ||
    "joeproai/launchpad-openclaw:2026.6.5-fly13"
  );
}

/** Docker Hub ref -> { repo, tag }, or null if not a hub image we can check. */
function parseDockerHubRepoTag(
  ref: string
): { repo: string; tag: string } | null {
  let r = ref.split("@")[0]; // drop any digest pin
  const firstSlash = r.indexOf("/");
  if (firstSlash > 0) {
    const host = r.slice(0, firstSlash);
    if (
      host === "docker.io" ||
      host === "registry-1.docker.io" ||
      host === "index.docker.io"
    ) {
      r = r.slice(firstSlash + 1);
    } else if (host.includes(".") || host.includes(":")) {
      return null; // some other registry -> we can't introspect it
    }
  }
  const colon = r.lastIndexOf(":");
  if (colon < 0) return null;
  const repo = r.slice(0, colon);
  const tag = r.slice(colon + 1);
  if (!repo.includes("/")) return null;
  return { repo, tag };
}

/** Does this image tag exist on Docker Hub? Non-hub refs are trusted (true). */
async function imageRefAvailable(ref: string): Promise<boolean> {
  const parsed = parseDockerHubRepoTag(ref);
  if (!parsed) return true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://hub.docker.com/v2/repositories/${parsed.repo}/tags/${encodeURIComponent(parsed.tag)}`,
      { signal: ctrl.signal, cache: "no-store" }
    );
    clearTimeout(t);
    return res.ok;
  } catch {
    return false; // inconclusive -> treat as unavailable; never deploy unverified
  }
}

/** Newest tag (by push time) that exists on Docker Hub for this ref's repo. */
async function newestAvailableImage(ref: string): Promise<string | null> {
  const parsed = parseDockerHubRepoTag(ref);
  if (!parsed) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://hub.docker.com/v2/repositories/${parsed.repo}/tags/?page_size=25`,
      { signal: ctrl.signal, cache: "no-store" }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ name?: string; tag_last_pushed?: string }>;
    };
    const tags = (data.results || []).filter(
      (x): x is { name: string; tag_last_pushed?: string } =>
        !!x.name && x.name !== "latest"
    );
    tags.sort((a, b) =>
      (b.tag_last_pushed || "").localeCompare(a.tag_last_pushed || "")
    );
    return tags[0] ? `${parsed.repo}:${tags[0].name}` : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the image to actually deploy. Prefer the desired tag; if it isn't on
 * the registry yet (a tag bump outran the image build+push), keep the machine
 * on its current image, else fall back to the newest tag that does exist --
 * never pull a tag that isn't there (which fails the machine).
 */
async function resolveDeployableImage(
  desired: string,
  currentImage: string
): Promise<string> {
  if (await imageRefAvailable(desired)) return desired;
  if (currentImage) {
    console.warn(
      `[launchpad/fly] image ${desired} not on registry; keeping current ${currentImage}`
    );
    return currentImage;
  }
  const newest = await newestAvailableImage(desired);
  console.warn(
    `[launchpad/fly] image ${desired} not on registry; new machine -> ${newest || desired}`
  );
  return newest || desired;
}

/**
 * Allocate a shared IPv4 + dedicated IPv6 for the app so <app>.fly.dev
 * resolves publicly. Idempotent — Fly returns existing addresses if they
 * already exist. The Machines REST API doesn't expose this, so we fall
 * back to GraphQL.
 */
async function ensureAppIps(appName: string): Promise<void> {
  const r = await fetch("https://api.fly.io/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${flyToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query($app:String!){ app(name:$app){ id sharedIpAddress ipAddresses{ nodes{ type } } } }`,
      variables: { app: appName },
    }),
  });
  const j = (await r.json()) as {
    data?: { app?: { id?: string; sharedIpAddress?: string | null; ipAddresses?: { nodes?: { type: string }[] } } };
    errors?: unknown;
  };
  if (j.errors || !j.data?.app?.id) {
    console.warn(`[launchpad/fly] could not query app ${appName} for IPs:`, JSON.stringify(j.errors));
    return;
  }
  const appId = j.data.app.id;
  const hasShared = !!j.data.app.sharedIpAddress;
  const hasV6 = (j.data.app.ipAddresses?.nodes || []).some((n) => n.type === "v6");
  const allocate = async (type: string) => {
    await fetch("https://api.fly.io/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${flyToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `mutation($app:ID!,$type:IPAddressType!){ allocateIpAddress(input:{appId:$app,type:$type}){ ipAddress{ address type } } }`,
        variables: { app: appId, type },
      }),
    });
  };
  if (!hasShared) await allocate("shared_v4");
  if (!hasV6) await allocate("v6");
}

/**
 * Per-product state-persistence config. Both products need a Fly Volume
 * because both write user-specific state that must survive machine
 * destroy/recreate (Fly platform maintenance, image bumps, config updates).
 *
 *   hermes   → OAuth tokens, agent memory, skill installs
 *   openclaw → channel credentials (Telegram/Discord/WhatsApp/Slack),
 *              resolved openclaw.json, installed skills, sessions
 *
 * Volume name and mount path are determined per product so each user's
 * app gets exactly one 1-GiB encrypted volume mounted where the container
 * actually writes state. Encrypted at rest by default on Fly.
 */
const PRODUCT_VOLUME: Record<LaunchpadProduct, { name: string; mount: string }> = {
  hermes: { name: "hermes_data", mount: "/workspace/.hermes" },
  openclaw: { name: "openclaw_data", mount: "/workspace/.openclaw" },
};

/**
 * Ensure a Fly Volume exists for this user's product state.
 * Returns the volume ID. Idempotent: reuses an existing volume named
 * per PRODUCT_VOLUME[product].name if present, else creates a 1 GiB one.
 *
 * Without this, anything written to the product's state directory vanishes
 * on machine destroy/recreate, so users have to reconnect channels and
 * reinstall skills on every Fly platform restart.
 */
async function ensureProductVolume(
  appName: string,
  product: LaunchpadProduct,
  region: string
): Promise<string> {
  type Vol = {
    id: string;
    name: string;
    region: string;
    size_gb: number;
    state?: string;
  };
  const volName = PRODUCT_VOLUME[product].name;
  const sizeGb = Math.max(1, Number(process.env.LAUNCHPAD_VOLUME_GB) || 1);

  // Reuse an existing volume for this app+product, but only one in the right
  // region -- Fly can't attach a cross-region volume ("volume not found"). A
  // volume already attached to the (stopped) machine is fine; we re-use its id.
  const findExisting = async (): Promise<string | null> => {
    const list = await flyFetch<Vol[]>(`/apps/${appName}/volumes`);
    const match = (Array.isArray(list) ? list : []).find(
      (v) => v.name === volName && v.region === region && v.state !== "destroyed"
    );
    return match?.id ?? null;
  };

  // Fly's volume API 5xxs transiently; retry a few times before giving up.
  // Throwing (not returning null) is deliberate: a persistence feature must
  // fail loudly, not silently hand back a machine that will lose user data.
  // LAUNCHPAD_USE_VOLUME=false is the escape hatch if Fly volumes melt down.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const existing = await findExisting();
      if (existing) return existing;
      const created = await flyFetch<Vol>(`/apps/${appName}/volumes`, {
        method: "POST",
        body: JSON.stringify({
          name: volName,
          region,
          size_gb: sizeGb,
          encrypted: true,
        }),
      });
      return created.id;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(
    `could not ensure ${volName} volume for ${appName}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

interface FlyApp {
  id: string;
  name: string;
  organization?: { slug: string };
}

interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  private_ip?: string;
  config?: Record<string, unknown>;
  created_at?: string;
}

/** Idempotent: returns the existing app, creating it (and IPs) if needed. */
async function ensureApp(name: string): Promise<FlyApp> {
  let app: FlyApp | null = null;
  try {
    app = await flyFetch<FlyApp>(`/apps/${name}`);
  } catch (err) {
    // 404 = app doesn't exist; any other error is fatal
    const msg = err instanceof Error ? err.message : String(err);
    if (!/->\s*404/.test(msg)) throw err;
  }
  if (!app) {
    app = await flyFetch<FlyApp>(`/apps`, {
      method: "POST",
      body: JSON.stringify({
        app_name: name,
        org_slug: flyOrg(),
        network: FLY_NETWORK,
      }),
    });
  }
  // Always ensure IPs (cheap idempotent check; needed for *.fly.dev DNS).
  await ensureAppIps(name);
  return app;
}

/** List the machines in an app (we use one per app, but list to find it). */
async function listMachines(appName: string): Promise<FlyMachine[]> {
  const out = await flyFetch<FlyMachine[]>(`/apps/${appName}/machines`);
  return Array.isArray(out) ? out : [];
}

interface ProvisionResult {
  appName: string;
  machineId: string;
  publicUrl: string;
  product: LaunchpadProduct;
  startedAt: string;
}

/**
 * Provision (or re-use) a Fly Machine for (userId, product).
 *
 * Idempotent: if a machine already exists in the user's app, we just make
 * sure it's started and re-apply the env (env changes when BYOK key is
 * added/removed, etc.).
 */
export async function provisionWorkspaceFly(
  userId: string,
  product: LaunchpadProduct,
  envVars: Record<string, string>,
  resources: { cpu: number; memory: number /* GiB */ }
): Promise<ProvisionResult> {
  const appName = await resolveAppName(userId, product);
  await ensureApp(appName);

  // Fetch the existing machine first so we know its current image before we
  // decide what to deploy.
  const existing = await listMachines(appName);
  const currentImage =
    existing.length > 0
      ? String(
          (existing[0].config as Record<string, unknown> | undefined)?.image ||
            ""
        )
      : "";

  // Must match the port each container actually binds (see launchpad-images/*/start.fly.sh).
  // Hermes dashboard runs `hermes dashboard --port 8080`; OpenClaw gateway binds 8080
  // (start.fly.sh launches it with --port ${OPENCLAW_GATEWAY_PORT:-8080}).
  // The old 8401/8400 values were the legacy Daytona-wrapper ports and routed Fly's
  // proxy at a closed port, so the machine never passed health and never launched.
  const internalPort = 8080;

  // imageFor() is the tag we *want*, but a code/Vercel tag bump can land before
  // the image is built+pushed. Never put a machine on a tag that isn't on the
  // registry: keep the current image (or newest that exists) instead of a ghost.
  const image = await resolveDeployableImage(imageFor(product), currentImage);

  // Convert memory GiB -> MB (Fly takes mb)
  const memoryMb = Math.round(resources.memory * 1024);

  // Persistent volume for product state (OAuth tokens for Hermes; channel
  // credentials + installed skills + openclaw.json for OpenClaw). Both
  // products write state that must survive machine destroy/recreate, which
  // Fly does on platform maintenance, image bumps, and config updates.
  // Volume is opt-in (LAUNCHPAD_USE_VOLUME=true). It only persists state across
  // machine destroy/recreate, and Fly's volume lifecycle (can't-add-on-update,
  // destroy lag -> "volume not found") caused repeated provision failures. Off
  // by default = simple, reliable machine creation; re-enable once stable.
  // Persistent volume is ON by default (durable auth/skills/memory across
  // image upgrades + restarts). Set LAUNCHPAD_USE_VOLUME=false to disable it
  // without a deploy if Fly's volume API ever starts failing launches.
  const useVolume = process.env.LAUNCHPAD_USE_VOLUME !== "false";
  const volumeId = useVolume
    ? await ensureProductVolume(appName, product, FLY_REGION)
    : null;

  const machineConfig: Record<string, unknown> = {
    image,
    env: envVars,
    services: [
      {
        ports: [
          { port: 80, handlers: ["http"], force_https: true },
          { port: 443, handlers: ["tls", "http"] },
        ],
        protocol: "tcp",
        internal_port: internalPort,
        // Scale-to-zero is handled by the in-image idle watchdog (see
        // launchpad-images/*/start.fly.sh): after ~15 min with no real traffic
        // it asks the control plane to SUSPEND this machine (RAM snapshot), so
        // the next request resumes in ~0.3s with the gateway already warm --
        // no cold re-bind, no multi-minute "Waking your agent" window.
        // autostop is "suspend" (not "off") so that if Fly's proxy ever does
        // scale us down, it suspends (warm resume) rather than fully stops
        // (cold boot). The earlier objection to proxy autostop -- it slept the
        // machine before the gateway had re-bound -- no longer applies, because
        // a suspended gateway resumes already-bound. The usage cron only bills
        // while Fly state is "started" (suspended/stopped == $0), so idle stays
        // free either way; suspend just makes the wake instant.
        autostop: "suspend",
        autostart: true,
        min_machines_running: 0,
      },
    ],
    guest: {
      cpu_kind: "shared",
      cpus: resources.cpu,
      memory_mb: memoryMb,
    },
    restart: { policy: "on-failure", max_retries: 3 },
    metadata: {
      launchpad: "true",
      userId,
      product,
    },
  };

  if (volumeId) {
    machineConfig.mounts = [
      {
        volume: volumeId,
        path: PRODUCT_VOLUME[product].mount,
      },
    ];
  }

  // Existing machine? Reconcile it; otherwise create a fresh one.
  const machineName = `node-${nameHash(`lp-machine:${userId}:${product}`).slice(0, 10)}`;
  const createMachine = (): Promise<FlyMachine> =>
    flyFetch<FlyMachine>(`/apps/${appName}/machines`, {
      method: "POST",
      body: JSON.stringify({
        name: machineName,
        region: FLY_REGION,
        config: machineConfig,
      }),
    });

  // A fresh volume can be a beat behind ready, and on destroy+recreate the
  // volume may still be detaching from the old machine. Retry so a transient
  // "volume not found / already attached" doesn't fail the launch.
  const createMachineWithRetry = async (): Promise<FlyMachine> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await createMachine();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    throw lastErr;
  };

  let machine: FlyMachine;
  if (existing.length === 0) {
    machine = await createMachineWithRetry();
  } else {
    machine = existing[0];
    const cfg = (machine.config as Record<string, unknown> | undefined) || {};
    const currentMounts = Array.isArray(cfg.mounts)
      ? (cfg.mounts as unknown[])
      : [];
    const wantsVolume = !!volumeId;
    const hasVolume = currentMounts.length > 0;

    // Fly forbids adding or removing a volume on an existing machine
    // ("unable to add volume after machine is created"). If the desired mount
    // state differs from how the machine was created, the only way to
    // reconcile is destroy + recreate. The Fly Volume persists independently,
    // so no user state is lost.
    if (wantsVolume !== hasVolume) {
      await flyFetch<unknown>(
        `/apps/${appName}/machines/${machine.id}?force=true`,
        { method: "DELETE" }
      );
      // Let Fly settle the delete so the volume fully detaches before we
      // re-attach it to the new machine (else "volume already attached").
      if (wantsVolume) await new Promise((r) => setTimeout(r, 4000));
      machine = await createMachineWithRetry();
    } else {
      // A config POST triggers a Fly *replace* (reboot + image re-pull), so
      // only do it when something material actually changed (the image). Doing
      // it on every provision call caused a reboot loop that killed the agent.
      const currentImage = String(cfg.image || "");
      const currentServices = Array.isArray(cfg.services)
        ? (cfg.services as Array<Record<string, unknown>>)
        : [];
      const currentAutostop = currentServices[0]?.autostop;
      // Update when the image changed OR the machine still has a stale
      // autostop policy. Desired policy is now "suspend" (warm resume); a
      // machine still on the old "off"/false reconciles once to "suspend",
      // then stays put — a machine already on the desired policy must NOT
      // count as changed (else it replace-loops on every provision).
      // Fly stores the image registry-qualified + digest-pinned, so match on
      // our repo:tag substring; a decorated-but-identical image must NOT count
      // as changed (else it replace-loops on every wake). Only a real tag bump.
      const imageChanged = !!image && !currentImage.includes(image);
      const autostopIsSuspend = currentAutostop === "suspend";
      const needsConfigUpdate = imageChanged || !autostopIsSuspend;
      if (needsConfigUpdate) {
        const updateConfig: Record<string, unknown> = { ...machineConfig };
        // Re-send current mounts verbatim — Fly rejects adding/removing a
        // volume on an existing machine.
        if (hasVolume) updateConfig.mounts = currentMounts;
        else delete updateConfig.mounts;
        await flyFetch<FlyMachine>(`/apps/${appName}/machines/${machine.id}`, {
          method: "POST",
          body: JSON.stringify({ config: updateConfig }),
        });
      }
      // Ensure it's running without racing any in-flight replace.
      await ensureMachineStarted(appName, machine.id);
    }
  }

  return {
    appName,
    machineId: machine.id,
    publicUrl: `https://${appName}.fly.dev`,
    product,
    startedAt: new Date().toISOString(),
  };
}

export async function stopWorkspaceFly(
  appName: string,
  machineId: string
): Promise<void> {
  try {
    await flyFetch<unknown>(`/apps/${appName}/machines/${machineId}/stop`, {
      method: "POST",
    });
  } catch (err) {
    console.warn(
      `[launchpad/fly] stop non-fatal for ${appName}/${machineId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export async function startWorkspaceFly(
  appName: string,
  machineId: string
): Promise<void> {
  await flyFetch<unknown>(`/apps/${appName}/machines/${machineId}/start`, {
    method: "POST",
  });
}

/**
 * Suspend a machine: snapshot RAM to storage and freeze it. Resume (on the
 * next request, via autostart) restores the snapshot in ~0.3s with every
 * process — including the already-bound gateway — exactly where it left off,
 * so there is no cold boot or gateway re-bind. Billing-wise a suspended
 * machine is "suspended" (not "started"), so the usage cron counts it as idle
 * ($0 compute; storage only). Used by the in-image idle watchdog via the
 * control plane so no Fly token ever has to live inside a user machine.
 * Non-fatal: a failure here just means the caller falls back to a plain stop.
 */
export async function suspendWorkspaceFly(
  appName: string,
  machineId: string
): Promise<void> {
  await flyFetch<unknown>(`/apps/${appName}/machines/${machineId}/suspend`, {
    method: "POST",
  });
}

/**
 * Tear down everything for (userId, product). Used on subscription cancel.
 * Removes the entire Fly app, which cleans up the machine, networks, certs.
 */
export async function deleteWorkspaceFly(appName: string): Promise<void> {
  try {
    await flyFetch<unknown>(`/apps/${appName}`, { method: "DELETE" });
  } catch (err) {
    console.warn(
      `[launchpad/fly] app delete non-fatal for ${appName}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export async function statusOfFly(
  appName: string,
  machineId: string
): Promise<{ state: string | undefined; image: string | undefined } | null> {
  try {
    const m = await flyFetch<FlyMachine>(
      `/apps/${appName}/machines/${machineId}`
    );
    const cfg = (m.config ?? {}) as { image?: unknown };
    return {
      state: m.state,
      image: cfg.image ? String(cfg.image) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Cheap liveness check on the Fly API token itself — independent of any
 * specific app. Used by the usage cron to detect a banned/revoked token
 * (platform-wide provisioning outage) within one cron interval, even when no
 * one is actively provisioning. Unlike `statusOfFly`, it does NOT swallow the
 * failure: it distinguishes an auth failure (401/403/"banned") from healthy.
 */
export async function checkFlyAuth(): Promise<{
  ok: boolean;
  status: number;
  banned: boolean;
  detail?: string;
}> {
  let status = 0;
  let detail = "";
  try {
    // Bounded so a hung Fly API can't eat the cron's execution budget (the
    // usage cron awaits this before its per-user loop). Matches the 5s
    // AbortController timeout used elsewhere in this file.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(
        `${FLY_API}/apps?org_slug=${encodeURIComponent(flyOrg())}`,
        { headers: flyHeaders(), signal: ctrl.signal, cache: "no-store" }
      );
      status = res.status;
      if (res.ok) return { ok: true, status, banned: false };
      detail = await res.text().catch(() => "");
    } finally {
      clearTimeout(t);
    }
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }
  const banned =
    status === 401 || status === 403 || /banned|unauthor/i.test(detail);
  return { ok: false, status, banned, detail: detail.slice(0, 300) };
}
