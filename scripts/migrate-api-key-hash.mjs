/**
 * migrate-api-key-hash.mjs
 *
 * One-time migration: read all agents with plaintext `apiKey`,
 * compute SHA-256 hash, write `apiKeyHash`, remove `apiKey`.
 *
 * Run ONCE after deploying the hashing changes:
 *   node scripts/migrate-api-key-hash.mjs
 *
 * Safe to re-run (idempotent — skips agents that already have apiKeyHash).
 * Requires GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON env.
 */

import { createHash } from "crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ── Init ─────────────────────────────────────────────────────────────────────

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : null;

if (!serviceAccount) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_JSON env var to run this migration");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Hash ──────────────────────────────────────────────────────────────────────

function hashApiKey(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Migrate ───────────────────────────────────────────────────────────────────

async function migrate() {
  const snap = await db.collection("agents").get();
  let migrated = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const doc of snap.docs) {
    const data = doc.data();

    if (!data.apiKey) {
      // No plaintext key — already migrated or a different agent type
      skipped++;
      continue;
    }

    if (data.apiKeyHash) {
      // Already has hash — idempotent skip
      console.log(`  skip  ${doc.id} (already has apiKeyHash)`);
      skipped++;
      continue;
    }

    try {
      const hash = hashApiKey(data.apiKey);
      await doc.ref.update({
        apiKeyHash: hash,
        apiKey:     FieldValue.delete(),  // remove plaintext
      });
      console.log(`  ✓  ${doc.id}  (${data.name ?? "unnamed"})  hash=${hash.slice(0, 16)}...`);
      migrated++;
    } catch (err) {
      console.error(`  ✗  ${doc.id}  ERROR:`, err.message);
      errors++;
    }
  }

  console.log(`\nDone. migrated=${migrated}  skipped=${skipped}  errors=${errors}`);
}

migrate().catch(console.error);
