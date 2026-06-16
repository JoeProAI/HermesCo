/**
 * launchpad-delete-test-user.mjs
 *
 * Deletes a launchpad_users/{userId} Firestore doc. Use to clean up
 * after running launchpad-e2e.mjs.
 *
 * Usage: node scripts/launchpad-delete-test-user.mjs <firebase-uid>
 */
import { readFileSync, existsSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

for (const f of [".env.vercel.local", ".env.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const userId = process.argv[2];
if (!userId) {
  console.error("usage: node scripts/launchpad-delete-test-user.mjs <firebase-uid>");
  process.exit(1);
}

const credentials = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
};
if (!credentials.projectId || !credentials.privateKey) {
  console.error("ERR: Firebase admin env vars missing");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(credentials) });
}

await getFirestore().collection("launchpad_users").doc(userId).delete();
console.log(`✓ deleted launchpad_users/${userId}`);
