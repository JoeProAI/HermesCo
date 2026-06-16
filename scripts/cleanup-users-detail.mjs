import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dirname, "../.env.local");
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const KEEP = new Set(["joe@joepro.ai", "jobeous@joepro.ai"]);

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");

const app = getApps().length ? getApps()[0] : initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth(app);
const db = getFirestore(app);

const all = [];
let token;
do {
  const p = await auth.listUsers(1000, token);
  token = p.pageToken;
  for (const u of p.users) {
    let plan = "?", credits = "?", spent = "?";
    try {
      const d = await db.collection("users").doc(u.uid).get();
      if (d.exists) {
        const x = d.data();
        plan = x?.plan || "free";
        credits = (x?.credits ?? "?").toString();
        spent = (x?.totalSpent ?? x?.lifetimeSpend ?? "?").toString();
      }
    } catch {}
    all.push({
      email: u.email || "(no email)",
      uid: u.uid,
      created: new Date(u.metadata.creationTime),
      lastSignIn: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime) : null,
      plan, credits, spent,
    });
  }
} while (token);

const toDelete = all.filter(u => !KEEP.has(u.email.toLowerCase()) && !u.email.toLowerCase().includes("jobeous"));
toDelete.sort((a, b) => (b.lastSignIn ?? b.created) - (a.lastSignIn ?? a.created));

const fmt = d => d ? d.toISOString().slice(0, 10) : "never";

console.log(`\n${toDelete.length} users to delete, sorted by most recent activity:\n`);
console.log(`DATE       SIGNUP     PLAN     CREDITS  SPENT  EMAIL`);
console.log(`---------- ---------- -------- -------- ------ -----`);
for (const u of toDelete) {
  console.log(
    fmt(u.lastSignIn).padEnd(11) +
    fmt(u.created).padEnd(11) +
    u.plan.padEnd(9) +
    u.credits.padEnd(9) +
    u.spent.padEnd(7) +
    u.email
  );
}

const recent = toDelete.filter(u => u.lastSignIn && u.lastSignIn > new Date(Date.now() - 7 * 86400e3));
const paid = toDelete.filter(u => Number(u.spent) > 0);
console.log(`\nActive in last 7 days: ${recent.length}`);
console.log(`Have ever spent money: ${paid.length}`);
if (paid.length) {
  console.log("\n⚠ PAID USERS ABOUT TO BE DELETED:");
  for (const u of paid) console.log(`  ${u.email} — spent=${u.spent} plan=${u.plan}`);
}
