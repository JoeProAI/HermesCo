/**
 * cleanup-users.mjs
 *
 * Step 1 (default): List all Firebase Auth users with plan/email.
 * Step 2 (--delete): Delete all users NOT in KEEP_EMAILS.
 *
 * Usage:
 *   node scripts/cleanup-users.mjs           # just list
 *   node scripts/cleanup-users.mjs --delete  # actually delete
 *
 * Requires env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * Load from .env.local automatically.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = resolve(__dirname, "../.env.local");
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] = val;
  }
} catch {
  console.error("Could not load .env.local — set FIREBASE_* env vars manually.");
}

// ── Accounts to keep ─────────────────────────────────────────────────
const KEEP_EMAILS = new Set([
  "joe@joepro.ai",
  "jobeous@joepro.ai",
  "joe@jobeous.com",
  "jobeous@gmail.com",
]);

// ── Also keep any UID that contains "jobeous" (safety net) ───────────
const KEEP_UID_CONTAINS = "jobeous";

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });

const auth = getAuth(app);
const db = getFirestore(app);

const DELETE_MODE = process.argv.includes("--delete");

console.log(`\n=== clawd.run User Cleanup ===`);
console.log(`Mode: ${DELETE_MODE ? "DELETE" : "LIST ONLY (pass --delete to actually delete)"}\n`);
console.log(`Keeping: ${[...KEEP_EMAILS].join(", ")}\n`);

// ── List all users ────────────────────────────────────────────────────
let nextPageToken;
const toDelete = [];
const toKeep = [];

do {
  const result = await auth.listUsers(1000, nextPageToken);
  nextPageToken = result.pageToken;

  for (const user of result.users) {
    const email = user.email || "(no email)";
    const uid = user.uid;
    const created = new Date(user.metadata.creationTime).toLocaleDateString();

    // Check Firestore for plan
    let plan = "unknown";
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) plan = doc.data()?.plan || "free";
    } catch {}

    const keep =
      KEEP_EMAILS.has(email) ||
      KEEP_EMAILS.has(email.toLowerCase()) ||
      uid.includes(KEEP_UID_CONTAINS) ||
      email.toLowerCase().includes("jobeous") ||
      email === "joe@joepro.ai";

    if (keep) {
      toKeep.push({ uid, email, plan, created });
    } else {
      toDelete.push({ uid, email, plan, created });
    }
  }
} while (nextPageToken);

console.log(`── KEEPING (${toKeep.length}) ──────────────────────────`);
for (const u of toKeep) {
  console.log(`  ✓ ${u.email.padEnd(35)} plan=${u.plan}  uid=${u.uid}  created=${u.created}`);
}

console.log(`\n── TO DELETE (${toDelete.length}) ────────────────────────`);
for (const u of toDelete) {
  console.log(`  ✗ ${u.email.padEnd(35)} plan=${u.plan}  uid=${u.uid}  created=${u.created}`);
}

if (!DELETE_MODE) {
  console.log(`\nRun with --delete to permanently remove the ${toDelete.length} users above.`);
  process.exit(0);
}

// ── Delete ────────────────────────────────────────────────────────────
console.log(`\nDeleting ${toDelete.length} users...`);
let deleted = 0;
let errors = 0;

for (const u of toDelete) {
  try {
    await auth.deleteUser(u.uid);
    console.log(`  deleted auth: ${u.email}`);
    deleted++;
  } catch (e) {
    console.error(`  ERROR deleting auth ${u.email}: ${e.message}`);
    errors++;
  }
}

console.log(`\nDone. Deleted: ${deleted}  Errors: ${errors}`);
console.log(`Firestore user docs left intact (agent state preserved for reference).`);
console.log(`Run 'node scripts/cleanup-users.mjs --purge-firestore' separately if you want those gone too.`);
