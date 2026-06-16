function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sanitizeOpenClawConfig(input: unknown): Record<string, unknown> {
  const config = isPlainObject(input) ? cloneConfig(input) : {};

  if (!isPlainObject(config.gateway)) config.gateway = {};
  if (!isPlainObject(config.agents)) config.agents = {};
  if (!isPlainObject((config.agents as Record<string, unknown>).defaults)) {
    (config.agents as Record<string, unknown>).defaults = {};
  }

  const defaults = (config.agents as Record<string, unknown>).defaults as Record<string, unknown>;

  // Older configs sometimes stored a skill allowlist directly at root.skills.
  // Current OpenClaw expects root.skills to be an object and per-agent skill
  // allowlists under agents.defaults.skills / agents.list[].skills.
  if (Array.isArray(config.skills)) {
    const migratedSkills = config.skills.filter((item): item is string => typeof item === "string");
    if (migratedSkills.length > 0 && !Array.isArray(defaults.skills)) {
      defaults.skills = migratedSkills;
    }
    delete config.skills;
  } else if (!isPlainObject(config.skills)) {
    delete config.skills;
  } else {
    const skills = config.skills as Record<string, unknown>;
    if ("entries" in skills && !isPlainObject(skills.entries)) {
      delete skills.entries;
    }
  }

  if (!isPlainObject(config.memory)) {
    config.memory = { backend: "builtin" };
  } else {
    const memory = config.memory as Record<string, unknown>;
    if (memory.backend !== "builtin" && memory.backend !== "qmd") {
      memory.backend = "builtin";
    }
  }

  if (!isPlainObject(config.plugins)) {
    delete config.plugins;
  } else {
    const plugins = config.plugins as Record<string, unknown>;
    if ("entries" in plugins && !isPlainObject(plugins.entries)) {
      delete plugins.entries;
    }
    if ("slots" in plugins && !isPlainObject(plugins.slots)) {
      delete plugins.slots;
    }
  }

  if (!isPlainObject(config.display)) {
    delete config.display;
  }

  return config;
}

export function serializeOpenClawConfig(input: unknown): string {
  return JSON.stringify(sanitizeOpenClawConfig(input), null, 2);
}
