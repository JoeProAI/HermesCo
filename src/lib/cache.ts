/**
 * Cache + rate-limit layer.
 *
 * Primary backend: Upstash Redis REST (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 * Fallback: in-process Map with TTL. Fine for local dev; serverless cold starts lose memory.
 *
 * Every `get` first checks cache; on miss caller should hydrate from source of truth
 * (Firestore) and call `set` with a TTL. `del` / `invalidate*` must be called on writes
 * to the underlying data (e.g. when a user's plan changes).
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);

// ── In-process fallback ────────────────────────────────────────────────
interface Entry {
  value: string;
  expiresAt: number; // ms since epoch; Infinity = never
}
const mem = new Map<string, Entry>();

function memGet(key: string): string | null {
  const e = mem.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    mem.delete(key);
    return null;
  }
  return e.value;
}

function memSet(key: string, value: string, ttlSeconds?: number): void {
  mem.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity,
  });
}

function memDel(key: string): void {
  mem.delete(key);
}

function memIncr(key: string, ttlSeconds?: number): number {
  const current = memGet(key);
  const n = current ? parseInt(current, 10) + 1 : 1;
  memSet(key, String(n), ttlSeconds);
  return n;
}

// ── Upstash REST helper ────────────────────────────────────────────────
async function upstash<T = unknown>(args: (string | number)[]): Promise<T | null> {
  if (!HAS_REDIS) return null;
  try {
    const res = await fetch(UPSTASH_URL!, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      // Short timeout — cache should never block request-path for long
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      console.warn("[cache] Upstash error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const body = await res.json() as { result: T };
    return body.result ?? null;
  } catch (err) {
    console.warn("[cache] Upstash request failed, falling through:", err);
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (HAS_REDIS) {
    const raw = await upstash<string>(["GET", key]);
    if (raw == null) return null;
    try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
  }
  const raw = memGet(key);
  if (raw == null) return null;
  try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
}

export async function cacheSet<T = unknown>(
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (HAS_REDIS) {
    if (ttlSeconds) await upstash(["SET", key, serialized, "EX", ttlSeconds]);
    else await upstash(["SET", key, serialized]);
    return;
  }
  memSet(key, serialized, ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  if (HAS_REDIS) {
    await upstash(["DEL", key]);
    return;
  }
  memDel(key);
}

/**
 * Atomic increment with optional TTL set on first create.
 * Returns the new value. Used for rate limiting.
 */
export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number> {
  if (HAS_REDIS) {
    const n = await upstash<number>(["INCR", key]);
    // On first increment (n===1), set TTL so the counter expires.
    if (n === 1 && ttlSeconds) await upstash(["EXPIRE", key, ttlSeconds]);
    return n ?? 1;
  }
  return memIncr(key, ttlSeconds);
}

// ── Domain helpers: user plan ──────────────────────────────────────────

const USER_PLAN_TTL = 300; // 5 min — short enough that upgrades propagate fast
const USER_DATA_TTL = 60;  // 1 min — for broader user object

export function userPlanKey(userId: string): string { return `user:${userId}:plan`; }
export function userDataKey(userId: string): string { return `user:${userId}:data`; }

/**
 * Cached plan lookup. Falls back to Firestore on miss.
 * Callers MUST call `invalidateUserPlan(userId)` whenever they mutate `users/{uid}.plan`.
 */
export async function getCachedUserPlan(
  userId: string,
  fallback: () => Promise<string>,
): Promise<string> {
  const cached = await cacheGet<string>(userPlanKey(userId));
  if (cached) return cached;
  const plan = await fallback();
  await cacheSet(userPlanKey(userId), plan, USER_PLAN_TTL);
  return plan;
}

export async function invalidateUserPlan(userId: string): Promise<void> {
  await Promise.all([
    cacheDel(userPlanKey(userId)),
    cacheDel(userDataKey(userId)),
  ]);
}

export async function getCachedUserData<T = Record<string, unknown>>(
  userId: string,
  fallback: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(userDataKey(userId));
  if (cached) return cached;
  const data = await fallback();
  await cacheSet(userDataKey(userId), data, USER_DATA_TTL);
  return data;
}

// ── Domain helpers: rate limits ────────────────────────────────────────

/**
 * Increment a rate-limit counter bucketed to the current window.
 * Returns { count, remaining, allowed }.
 *
 * @param bucket  Identifier like `tasks:${userId}` or `signup:${ip}`.
 * @param limit   Max allowed within the window.
 * @param windowSeconds  Window size (e.g. 86400 for per-day).
 */
export async function checkRateLimitCached(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<{ count: number; remaining: number; allowed: boolean }> {
  // Bucket key includes the current window-start so counters reset naturally.
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const key = `rl:${bucket}:${windowStart}`;
  const count = await cacheIncr(key, windowSeconds + 60);
  return {
    count,
    remaining: Math.max(0, limit - count),
    allowed: count <= limit,
  };
}

// Introspection for health checks / debug endpoints.
export function cacheBackend(): "upstash" | "memory" {
  return HAS_REDIS ? "upstash" : "memory";
}
