/**
 * launchpad-verify-user.mjs
 *
 * Reads launchpad_users/{userId} from Firestore directly (Firebase admin SDK)
 * and prints what's there. Pairs with launchpad-e2e.mjs: after running the
 * webhook test, run this to confirm the doc was actually written.
 *
 * Usage:
 *   node scripts/launchpad-verify-user.mjs <firebase-uid>
 *
 * Auth: uses the same FIREBASE_SERVICE_ACCOUNT_KEY env var the Next.js app uses.
 * Pull it from Vercel first if not local: `vercel env pull .env.vercel.local`
 */
import { readFileSync, existsSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ── load env ────────────────────────────────────────────────────────────────
function loadEnv() {
  for (const f of [".env.vercel.local", ".env.local"]) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf-8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();

const userId = process.argv[2];
if (!userId) {
  console.error("usage: node scripts/launchpad-verify-user.mjs <firebase-uid>");
  process.exit(1);
}

// ── init admin ──────────────────────────────────────────────────────────────
// Match how src/lib/firebase-admin.ts initializes: individual env vars
// FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (with
// escaped newlines). Falls back to FIREBASE_SERVICE_ACCOUNT_KEY JSON blob.
let credentials;
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
  credentials = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  try {
    credentials = JSON.parse(saKey);
  } catch {
    credentials = JSON.parse(Buffer.from(saKey, "base64").toString("utf-8"));
  }
} else {
  console.error(
    "ERR: need either FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or FIREBASE_SERVICE_ACCOUNT_KEY"
  );
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(credentials) });
}
const db = getFirestore();

// ── read + print ────────────────────────────────────────────────────────────
const snap = await db.collection("launchpad_users").doc(userId).get();
if (!snap.exists) {
  console.log(`✗ launchpad_users/${userId} does NOT exist`);
  process.exit(2);
}
const data = snap.data();
console.log(`✓ launchpad_users/${userId} exists`);
console.log(JSON.stringify(data, null, 2));
process.exit(0);
