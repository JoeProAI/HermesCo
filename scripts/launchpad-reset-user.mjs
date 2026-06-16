// Tear down a single Launchpad user's workspaces — destroys Daytona sandboxes
// and clears the workspaces map in Firestore so next provision is fresh.
// Tunnels are preserved (stable per uid+product).
//
// Usage:  node scripts/launchpad-reset-user.mjs <userId>

import { Daytona } from "@daytonaio/sdk";
import admin from "firebase-admin";

const userId = process.argv[2];
if (!userId) { console.error("usage: node scripts/launchpad-reset-user.mjs <userId>"); process.exit(1); }

const dt = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, target: process.env.DAYTONA_TARGET || "us" });

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) {
  console.error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY required");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
const db = admin.firestore();

const ref = db.collection("launchpad_users").doc(userId);
const snap = await ref.get();
if (!snap.exists) { console.log(`no launchpad_users doc for ${userId}`); process.exit(0); }

const data = snap.data();
const wks = data?.workspaces || {};
console.log("# workspaces in Firestore:", Object.keys(wks));

for (const [product, ws] of Object.entries(wks)) {
  if (!ws?.sandboxId) { console.log(`${product}: no sandboxId, skipping`); continue; }
  console.log(`\n--- ${product}: sandbox ${ws.sandboxId} ---`);
  try {
    const sb = await dt.get(ws.sandboxId);
    console.log(`state=${sb.state}, deleting...`);
    await sb.delete();
    console.log("deleted");
  } catch (err) {
    console.log(`delete non-fatal: ${err.message}`);
  }
}

// Clear the workspaces map. Tunnels stay (cfTunnels untouched).
await ref.update({ workspaces: {} });
console.log("\n# Firestore workspaces cleared. Tunnels preserved.");
