/**
 * One-off: provision a Fly Machine for Joe's user (Hermes) and report URL.
 *
 * Reads FLY_API_TOKEN, DAYTONA_API_KEY, LAUNCHPAD_OPENROUTER_POOL_KEY from env
 * (run `vercel env pull` first or set them inline).
 */

const FLY = "https://api.machines.dev/v1";
const TOK = process.env.FLY_API_TOKEN;
if (!TOK) throw new Error("FLY_API_TOKEN missing");

const userId = "3dvGcODVv5hMevalPMR6VGYBGy92";
const appName = "lp-hermes-3dvgcodv";

async function fly(path, init = {}) {
  const r = await fetch(FLY + path, {
    ...init,
    headers: {
      Authorization: TOK,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Fly ${init.method || "GET"} ${path} -> ${r.status}: ${t}`);
  }
  if (r.status === 204) return undefined;
  return r.json();
}

console.log("1) Create app...");
try {
  const app = await fly("/apps", {
    method: "POST",
    body: JSON.stringify({
      app_name: appName,
      org_slug: "personal",
      network: "default",
    }),
  });
  console.log("   created:", app.name);
} catch (e) {
  if (/422|already|exists/i.test(e.message)) console.log("   already exists");
  else throw e;
}

console.log("\n2) Create machine...");
const cfg = {
  image: "joeproai/launchpad-hermes:0.14.0-fly",
  env: {
    LAUNCHPAD_USER_ID: userId,
    LAUNCHPAD_LLM_PROVIDER: "openrouter",
    LAUNCHPAD_LLM_KEY: process.env.LAUNCHPAD_OPENROUTER_POOL_KEY || "",
    DAYTONA_API_KEY: process.env.DAYTONA_API_KEY || "",
    HERMES_MODEL: "anthropic/claude-haiku-4.5",
  },
  services: [
    {
      ports: [
        { port: 80, handlers: ["http"], force_https: true },
        { port: 443, handlers: ["tls", "http"] },
      ],
      protocol: "tcp",
      internal_port: 8080,
      autostop: "suspend",
      autostart: true,
      min_machines_running: 0,
    },
  ],
  guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
  restart: { policy: "on-failure", max_retries: 3 },
  metadata: { launchpad: "true", userId, product: "hermes" },
};
const machineName = `hermes-${userId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const m = await fly(`/apps/${appName}/machines`, {
  method: "POST",
  body: JSON.stringify({ name: machineName, region: "iad", config: cfg }),
});
console.log("   id:", m.id, "state:", m.state);

console.log("\n3) Wait for started...");
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await fly(`/apps/${appName}/machines/${m.id}`);
  console.log(`   ${i * 2}s: ${s.state}`);
  if (s.state === "started") break;
  if (["failed", "destroyed", "crashed"].includes(s.state)) {
    console.error("FAILED:", s);
    process.exit(1);
  }
}

console.log("\n4) Public URL:", `https://${appName}.fly.dev`);
console.log("\n5) Quick health check (HTTP GET /):");
try {
  const r = await fetch(`https://${appName}.fly.dev/`, { redirect: "manual" });
  console.log("   ->", r.status, r.headers.get("content-type"));
} catch (e) {
  console.log("   err:", e.message);
}
