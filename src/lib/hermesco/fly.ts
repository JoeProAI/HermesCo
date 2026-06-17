// HermesCo - the agent's body. Every HermesCo agent is spun up as a REAL,
// dedicated Fly Machine (multi-core performance box), not a server-side loop.
// The agent does its real work ON that machine via Fly's Machines `exec` API,
// the machine is metered, and it suspends to $0 compute when idle and resumes
// warm. This is the "run real operations at any scale" substrate - reused from
// the clawd.run launchpad, refocused on autonomous agent bodies.
//
// No fake data: provisioning, exec, and lifecycle all hit the live Fly API. If
// FLY_API_TOKEN is unset the module reports unconfigured rather than faking it.

const FLY_API = "https://api.machines.dev/v1";

const AGENTS_APP = process.env.HERMESCO_AGENTS_APP || "hermesco-agents";
const REGION = process.env.FLY_REGION || "iad";
const ORG = process.env.FLY_ORG_SLUG || "personal";

// Real horsepower by default - dedicated performance vCPUs, not the free
// shared-cpu minimum. Tunable up for heavy jobs via env.
const AGENT_IMAGE =
  process.env.HERMESCO_AGENT_IMAGE || "nikolaik/python-nodejs:python3.12-nodejs22";
const AGENT_CPU_KIND = process.env.HERMESCO_AGENT_CPU_KIND || "performance";
const AGENT_CPUS = Math.max(1, Number(process.env.HERMESCO_AGENT_CPUS) || 2);
const AGENT_MEMORY_MB =
  Math.max(512, Number(process.env.HERMESCO_AGENT_MEMORY_MB) || 4096);

// Transparent, labelled estimate of the real Fly compute cost of an agent body
// while it is running (performance vCPU + RAM). Surfaced as infra telemetry -
// never silently debited from the Treasury, which stays driven by real Stripe.
const COMPUTE_USD_PER_MIN =
  Number(process.env.HERMESCO_COMPUTE_USD_PER_MIN) || 0.0016;

export function flyConfigured(): boolean {
  return !!process.env.FLY_API_TOKEN;
}

export interface AgentMachine {
  id: string;
  name: string;
  state: string; // created | starting | started | suspended | stopped | ...
  region: string;
  image: string;
  cpuKind: string;
  cpus: number;
  memoryMb: number;
  role: string;
  agentId: string;
  workspaceId: string;
  goal: string;
  createdAt: string;
  uptimeMs: number;
  computeCostUsd: number; // est. real Fly compute since creation (labelled)
}

export interface MachineExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface FlyApp {
  id: string;
  name: string;
}

interface FlyMachineRaw {
  id: string;
  name: string;
  state: string;
  region: string;
  created_at?: string;
  config?: {
    image?: string;
    guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number };
    metadata?: Record<string, string>;
  };
}

interface FlyExecRaw {
  exit_code?: number;
  stdout?: string;
  stderr?: string;
}

function token(): string {
  const t = process.env.FLY_API_TOKEN;
  if (!t) throw new Error("FLY_API_TOKEN not configured. Cannot spin up agent machines.");
  return t;
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
}

async function flyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${FLY_API}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fly ${init.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const COMPUTE_PER_MS = COMPUTE_USD_PER_MIN / 60000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapMachine(m: FlyMachineRaw): AgentMachine {
  const meta = m.config?.metadata || {};
  const guest = m.config?.guest || {};
  const createdAt = m.created_at || new Date().toISOString();
  // Compute cost accrues only while the machine is actually started (running).
  // Suspended/stopped machines bill $0 compute, matching Fly's model.
  const billing = m.state === "started";
  const uptimeMs = billing ? Math.max(0, Date.now() - new Date(createdAt).getTime()) : 0;
  return {
    id: m.id,
    name: m.name,
    state: m.state,
    region: m.region,
    image: m.config?.image || AGENT_IMAGE,
    cpuKind: guest.cpu_kind || AGENT_CPU_KIND,
    cpus: guest.cpus || AGENT_CPUS,
    memoryMb: guest.memory_mb || AGENT_MEMORY_MB,
    role: meta.role || "agent-body",
    agentId: meta.agentId || "",
    workspaceId: meta.workspaceId || "",
    goal: meta.goal || "",
    createdAt,
    uptimeMs,
    computeCostUsd: round2(uptimeMs * COMPUTE_PER_MS),
  };
}

async function ensureAgentsApp(): Promise<void> {
  try {
    await flyFetch<FlyApp>(`/apps/${AGENTS_APP}`);
    return;
  } catch (err) {
    if (!/->\s*404/.test(String(err))) throw err;
  }
  await flyFetch<FlyApp>(`/apps`, {
    method: "POST",
    body: JSON.stringify({ app_name: AGENTS_APP, org_slug: ORG, network: "default" }),
  });
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// Spin up a real, powerful, dedicated Fly machine as an agent body and wait for
// it to be running. The machine stays alive (`sleep infinity` as PID 1) so the
// agent can exec real work on it; it suspends to $0 when idle.
export async function provisionAgentMachine(opts: {
  agentId?: string;
  label?: string;
  goal?: string;
  workspaceId?: string;
}): Promise<AgentMachine> {
  await ensureAgentsApp();
  const agentId = opts.agentId || `agent-${shortId()}`;
  const created = await flyFetch<FlyMachineRaw>(`/apps/${AGENTS_APP}/machines`, {
    method: "POST",
    body: JSON.stringify({
      name: `agent-${shortId()}-${Date.now().toString(36)}`,
      region: REGION,
      config: {
        image: AGENT_IMAGE,
        guest: { cpu_kind: AGENT_CPU_KIND, cpus: AGENT_CPUS, memory_mb: AGENT_MEMORY_MB },
        init: { exec: ["sleep", "infinity"] },
        auto_destroy: false,
        restart: { policy: "on-failure", max_retries: 3 },
        metadata: {
          platform: "hermesco",
          role: "agent-body",
          agentId,
          workspaceId: opts.workspaceId || "",
          goal: (opts.goal || opts.label || "").slice(0, 200),
        },
      },
    }),
  });
  await waitForState(created.id, "started", 90).catch(() => undefined);
  const fresh = await getAgentMachine(created.id);
  return fresh || mapMachine(created);
}

export async function listAgentMachines(): Promise<AgentMachine[]> {
  let raw: FlyMachineRaw[];
  try {
    raw = await flyFetch<FlyMachineRaw[]>(`/apps/${AGENTS_APP}/machines`);
  } catch (err) {
    if (/->\s*404/.test(String(err))) return [];
    throw err;
  }
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((m) => (m.config?.metadata || {}).platform === "hermesco")
    .map(mapMachine)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getAgentMachine(id: string): Promise<AgentMachine | null> {
  try {
    const m = await flyFetch<FlyMachineRaw>(`/apps/${AGENTS_APP}/machines/${id}`);
    return mapMachine(m);
  } catch (err) {
    if (/->\s*404/.test(String(err))) return null;
    throw err;
  }
}

export async function waitForState(
  id: string,
  state: string,
  timeoutSec = 60,
): Promise<void> {
  await flyFetch<unknown>(
    `/apps/${AGENTS_APP}/machines/${id}/wait?state=${state}&timeout=${timeoutSec}`,
  );
}

// Run a real shell command on the agent's own machine and return the real
// result. Resumes a suspended machine first (warm) so the agent's body is
// always reachable.
export async function execOnMachine(
  id: string,
  command: string,
  opts: { timeoutSec?: number } = {},
): Promise<MachineExecResult> {
  const started = Date.now();
  const current = await getAgentMachine(id);
  if (current && current.state !== "started") {
    await startAgentMachine(id).catch(() => undefined);
    await waitForState(id, "started", 30).catch(() => undefined);
  }
  const res = await flyFetch<FlyExecRaw>(`/apps/${AGENTS_APP}/machines/${id}/exec`, {
    method: "POST",
    body: JSON.stringify({
      command: ["/bin/bash", "-lc", command],
      timeout: opts.timeoutSec ?? 60,
    }),
  });
  return {
    exitCode: typeof res.exit_code === "number" ? res.exit_code : null,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
    durationMs: Date.now() - started,
  };
}

// Find the live agent body for a workspace, or spin one up. Fly is the source
// of truth - the machine is tagged with its workspaceId, so the body survives
// app restarts and is reused across turns. Destroyed machines are skipped.
export async function ensureAgentBody(
  workspaceId: string,
  goal?: string,
): Promise<AgentMachine> {
  const fleet = await listAgentMachines();
  const existing = fleet.find(
    (m) => m.workspaceId === workspaceId && m.state !== "destroyed" && m.state !== "destroying",
  );
  if (existing) return existing;
  return provisionAgentMachine({ workspaceId, goal });
}

export async function startAgentMachine(id: string): Promise<void> {
  await flyFetch<unknown>(`/apps/${AGENTS_APP}/machines/${id}/start`, { method: "POST" });
}

export async function suspendAgentMachine(id: string): Promise<void> {
  await flyFetch<unknown>(`/apps/${AGENTS_APP}/machines/${id}/suspend`, { method: "POST" });
}

export async function destroyAgentMachine(id: string): Promise<void> {
  await flyFetch<unknown>(`/apps/${AGENTS_APP}/machines/${id}?force=true`, {
    method: "DELETE",
  });
}

export const AGENT_SPEC = {
  image: AGENT_IMAGE,
  cpuKind: AGENT_CPU_KIND,
  cpus: AGENT_CPUS,
  memoryMb: AGENT_MEMORY_MB,
  region: REGION,
  app: AGENTS_APP,
};
