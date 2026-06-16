/**
 * Operational alerting for the Launchpad provisioning path.
 *
 * The platform runs every user's Fly machine in a single Fly org under a single
 * API token. If that token is revoked/banned (Fly auto-bans tokens it detects
 * as leaked) the entire platform's provisioning goes dark — every launch and
 * new signup returns 500 — and historically this failed *silently*. This module
 * turns that into a page: it classifies Fly failures and notifies the operator
 * via a Slack-style webhook and/or email, throttled so one outage doesn't
 * produce a flood of duplicate alerts.
 */
import { createHash } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { sendEmail } from "@/lib/email";

export type OpsAlertSeverity = "critical" | "warning";

export interface OpsAlertInput {
  /** Stable dedupe key, e.g. "fly_provision_auth". One alert per key per cooldown. */
  key: string;
  title: string;
  body: string;
  severity?: OpsAlertSeverity;
  /** Suppress duplicate alerts for the same key within this window. */
  cooldownMs?: number;
}

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * True when a thrown Fly error looks like a banned/revoked/expired/missing
 * token (a platform-wide auth outage) rather than a one-off machine error.
 * Errors from `flyFetch` carry the HTTP status + body, e.g.
 * `Fly API GET /apps/... -> 401: root banned: <id>`.
 */
export function isFlyAuthFailure(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("banned") ||
    msg.includes("unauthorized") ||
    msg.includes("-> 401") ||
    msg.includes("-> 403") ||
    msg.includes("fly_api_token not configured") ||
    (msg.includes("token") && msg.includes("expired"))
  );
}

/**
 * Build a throttle key that groups *identical* failures while keeping
 * *distinct* failures separate. A fixed prefix alone would let one user's
 * failure suppress a genuinely different failure from another user within the
 * cooldown window; a per-user key would flood during a platform-wide outage.
 * Keying on a normalized signature of the error message is the middle ground:
 * repeated identical errors collapse to one alert, new errors still page.
 */
export function errorAlertKey(prefix: string, detail: string): string {
  const normalized = detail
    .toLowerCase()
    .replace(/0x[0-9a-f]+|[0-9a-f]{8,}/g, "#") // ids/hashes/digests -> stable token
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const sig = createHash("sha1").update(normalized).digest("hex").slice(0, 10);
  return `${prefix}_${sig}`;
}

/**
 * Returns true at most once per cooldown window for a given key. Best-effort:
 * if the throttle store is unreachable we err toward sending (a duplicate alert
 * is better than a missed outage).
 */
async function claimAlertSlot(key: string, cooldownMs: number): Promise<boolean> {
  try {
    const db = getAdminDb();
    const ref = db.collection("ops_alerts").doc(key);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const last = snap.exists
        ? (snap.data()?.lastNotifiedAt as number | undefined)
        : undefined;
      const now = Date.now();
      if (last && now - last < cooldownMs) return false;
      tx.set(
        ref,
        { lastNotifiedAt: now, count: FieldValue.increment(1) },
        { merge: true }
      );
      return true;
    });
  } catch (err) {
    console.error("[ops-alert] throttle store unavailable; sending anyway", err);
    return true;
  }
}

async function postWebhook(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function emailOps(subject: string, text: string): Promise<void> {
  // sendEmail falls back to a placeholder Resend key when unconfigured, which
  // would throw — only attempt email when Resend is actually set up.
  if (!process.env.RESEND_API_KEY) return;
  const to = process.env.OPS_ALERT_EMAIL || "joe@joepro.ai";
  await sendEmail({ to, subject, text });
}

/**
 * Send an operational alert. Never throws — alerting must not break the path it
 * is observing. De-duplicated per `key` within `cooldownMs`.
 */
export async function alertOps(input: OpsAlertInput): Promise<void> {
  const {
    key,
    title,
    body,
    severity = "warning",
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = input;
  try {
    if (!(await claimAlertSlot(key, cooldownMs))) return;
    const tag = severity === "critical" ? "CRITICAL" : "WARNING";
    const text = `[clawd.run ops] ${tag} — ${title}\n\n${body}`;
    const results = await Promise.allSettled([
      postWebhook(text),
      emailOps(`[clawd.run] ${tag}: ${title}`, `${body}\n\n— clawd.run ops alert`),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[ops-alert] delivery channel failed", r.reason);
      }
    }
  } catch (err) {
    console.error("[ops-alert] failed to send alert", err);
  }
}
