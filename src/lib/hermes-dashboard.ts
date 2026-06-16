import { normalizePlan, TIER_MODELS } from "@/lib/stripe";

function normalizeHermesModel(model: string): string {
  return model.replace(/^clawd-/, "");
}

export function getHermesModelForTier(tier: string): string {
  const normalized = normalizePlan(tier) ?? tier;
  return normalizeHermesModel(
    TIER_MODELS[normalized]?.primary || TIER_MODELS.free.primary,
  );
}

export function buildHermesConfigYaml(tier: string, proxyBaseUrl: string): string {
  const model = getHermesModelForTier(tier);

  return [
    "model:",
    '  provider: "custom"',
    `  model: "${model}"`,
    `  base_url: "${proxyBaseUrl}"`,
    "memory:",
    '  backend: "builtin"',
    "approvals:",
    '  mode: "manual"',
    'timezone: "America/New_York"',
    "",
  ].join("\n");
}

export function buildHermesEnvFile(proxyToken: string, braveApiKey = ""): string {
  return [
    `OPENAI_API_KEY=${proxyToken}`,
    `BRAVE_API_KEY=${braveApiKey}`,
    "",
  ].join("\n");
}

export function buildHermesDashboardStartCommand(
  workspaceDir = "/home/node/workspace",
  hermesHome = "/home/node/.hermes",
): string {
  return (
    `mkdir -p ${hermesHome} && ` +
    `pkill -f "hermes dashboard" 2>/dev/null || true; sleep 1; ` +
    `nohup bash -lc 'cd ${workspaceDir} && ` +
    `export HOME=/home/node HERMES_HOME=${hermesHome}; ` +
    `hermes dashboard --host 127.0.0.1 --port 9119 --no-open --tui' ` +
    `> /tmp/hermes-dashboard.log 2>&1 &`
  );
}

export function buildHermesConfigWriteCommand(
  tier: string,
  proxyBaseUrl: string,
  proxyToken: string,
  braveApiKey = "",
  hermesHome = "/home/node/.hermes",
): string {
  const hermesConfigB64 = Buffer.from(
    buildHermesConfigYaml(tier, proxyBaseUrl),
    "utf8",
  ).toString("base64");
  const hermesEnvB64 = Buffer.from(
    buildHermesEnvFile(proxyToken, braveApiKey),
    "utf8",
  ).toString("base64");

  return (
    `mkdir -p ${hermesHome} && ` +
    `echo '${hermesConfigB64}' | base64 -d > ${hermesHome}/config.yaml && ` +
    `echo '${hermesEnvB64}' | base64 -d > ${hermesHome}/.env && ` +
    `chmod 600 ${hermesHome}/.env`
  );
}
