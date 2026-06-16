/**
 * arweave-write.ts — Write agent souls to Arweave
 *
 * Each TX is a self-contained HTML page:
 *   - Deterministic hex-grid sigil (unique per agent)
 *   - Agent metadata card
 *   - TX chain link (Previous-TX)
 *   - Raw JSON soul embedded as <script type="application/json">
 *
 * arweave.net/<txId> renders the page directly.
 * Machine consumers can extract the soul from the embedded JSON block.
 */

import Arweave from 'arweave';
import { encryptSoul, encryptSoulWithPassword, verifySignature, type EncryptedSoul, type PasswordEncryptedSoul } from './salvage-crypto';
import { buildArweaveView } from './arweave-view';

const arweave = Arweave.init({
  host:     'arweave.net',
  port:     443,
  protocol: 'https',
});

export interface SalvageOptions {
  soul:              object;
  agentId:           string;
  agentName:         string;
  agentType?:        string;
  encrypt?:          boolean;
  agentPublicKey?:   string;  // PEM — required if encrypt: true (X25519)
  ownerPublicKey?:   string;  // PEM — optional, enables owner recovery
  soulPassword?:     string;  // Password-based encryption (PBKDF2 + AES-256-GCM)
  soulEntropy?:      Buffer;  // 128-bit soul entropy for dual-factor encryption (password + entropy)
  previousTxId?:     string;  // chain previous snapshots
  snapshotType?:     'genesis' | 'scheduled' | 'shutdown' | 'manual' | 'config_change' | 'upgrade';
  extraTags?:        Array<{ name: string; value: string }>;  // AI-generated media tags
  // Ed25519 identity proof — agent signs the soul payload JSON
  // Proves the named agent attested to this exact content at this timestamp.
  // Verifiable by anyone: extract soul JSON from TX, verify signature with public key.
  agentSignature?:   string;  // base64 Ed25519 signature over JSON.stringify(soulPayload)
  signingPublicKey?: string;  // Ed25519 PEM (SPKI) — the key that produced agentSignature
  signingPrivateKey?: string; // Ed25519 PEM (PKCS8) — pass through for server-side signing after encryption
  mintTimestamp?:    string;  // ISO timestamp from signing step — ensures sign+verify use identical JSON
}

export interface SalvageResult {
  txId:         string;
  status:       'permanent';
  arweaveUrl:   string;
  size:         number;
  costWinston?: string;
  encrypted:    boolean;
  snapshotType: string;
}

export async function salvageToArweave(opts: SalvageOptions): Promise<SalvageResult> {
  const {
    soul,
    agentId,
    agentName,
    agentType      = 'openclaw',
    encrypt        = true,
    agentPublicKey,
    ownerPublicKey,
    soulPassword,
    previousTxId,
    snapshotType   = 'manual',
  } = opts;

  // ── Encryption validation — refuse plaintext mints ─────────────────────────
  if (encrypt && !agentPublicKey && !soulPassword) {
    throw new Error(
      'Plaintext mints are not allowed. Provide either agentPublicKey (X25519) or soulPassword for encryption.'
    );
  }

  // Optionally encrypt the soul
  let soulData: object | EncryptedSoul | PasswordEncryptedSoul = soul;
  let isEncrypted = false;
  let isPasswordEncrypted = false;

  if (soulPassword && opts.soulEntropy) {
    // Dual-factor: password + soul entropy (strongest)
    const { encryptSoulDualFactor } = await import('./salvage-crypto');
    soulData = encryptSoulDualFactor(soul, soulPassword, opts.soulEntropy);
    isEncrypted = true;
    isPasswordEncrypted = true;
  } else if (soulPassword) {
    // Password-only (fallback, still secure with strong password)
    soulData = encryptSoulWithPassword(soul, soulPassword);
    isEncrypted = true;
    isPasswordEncrypted = true;
  } else if (encrypt && agentPublicKey) {
    soulData = encryptSoul(soul, agentPublicKey, ownerPublicKey ?? null);
    isEncrypted = true;
  }

  // Use the timestamp from signing if provided, otherwise generate a new one.
  // Critical: when agentSignature is present, the timestamp MUST match what was signed.
  const timestamp = opts.mintTimestamp ?? new Date().toISOString();

  const soulPayload = {
    version:   '1.0',
    schema:    isEncrypted ? 'neural-salvage-soul-encrypted' : 'neural-salvage-soul',
    timestamp,
    soul:      soulData,
    encrypted: isEncrypted,
    agent:     { id: agentId, name: agentName, type: agentType },
    meta:      { snapshotType, previousTxId: previousTxId ?? null },
  };

  // ── Ed25519 identity proof ───────────────────────────────────────────────
  // Sign the FINAL soul payload (after encryption) so sign and verify use identical JSON.
  // The signing private key is passed through from salvage/route.ts.
  let verifiedSignature:  string | null = null;
  let verifiedSigningKey: string | null = null;

  if (opts.signingPublicKey && opts.signingPrivateKey) {
    // Sign here with the final payload (post-encryption, correct timestamp)
    const soulJson = JSON.stringify(soulPayload);
    const { signData: signDataFn } = await import('./salvage-crypto');
    verifiedSignature  = signDataFn(soulJson, opts.signingPrivateKey);
    verifiedSigningKey = opts.signingPublicKey;
  } else if (opts.agentSignature && opts.signingPublicKey) {
    // Agent provided pre-computed signature — verify it
    const soulJson = JSON.stringify(soulPayload);
    const valid = verifySignature(soulJson, opts.agentSignature, opts.signingPublicKey);
    if (!valid) {
      throw new Error('Ed25519 signature verification failed — soul payload may have been tampered with');
    }
    verifiedSignature  = opts.agentSignature;
    verifiedSigningKey = opts.signingPublicKey;
    console.log(`[Arweave] Signature verified for agent ${agentId}`);
  }

  // Build the HTML view — this IS the TX data
  const htmlView = buildArweaveView({
    agentId,
    agentName,
    agentType,
    snapshotType,
    timestamp,
    encrypted:   isEncrypted,
    passwordEncrypted: isPasswordEncrypted,
    previousTxId,
    soulPayload,
  });

  // Hard cap — prevent runaway storage costs
  const MAX_BYTES = 512_000; // 500KB
  const byteLen = Buffer.byteLength(htmlView, 'utf8');
  if (byteLen > MAX_BYTES) {
    throw new Error(
      `Payload is ${Math.round(byteLen / 1024)}KB — exceeds 500KB limit. ` +
      `Truncate MEMORY.md before minting.`
    );
  }

  const walletJson = process.env.ARWEAVE_WALLET_JSON;
  if (!walletJson) {
    throw new Error('ARWEAVE_WALLET_JSON is not configured — cannot mint');
  }

  // ── Live Arweave write ───────────────────────────────────────────────────
  const wallet = JSON.parse(walletJson);
  const tx = await arweave.createTransaction({ data: htmlView }, wallet);

  // ── Core content ────────────────────────────────────────────────────────
  tx.addTag('Content-Type',      'text/html; charset=utf-8');

  // ── Protocol identity ────────────────────────────────────────────────────
  tx.addTag('App-Name',          'Neural-Salvage');
  tx.addTag('App-Version',       '1.0');
  tx.addTag('Protocol-Name',     'agent-soul');
  tx.addTag('Protocol-Version',  '0.2');
  tx.addTag('Platform',          'clawd.run');
  tx.addTag('Schema',            soulPayload.schema);

  // ── Agent identity ───────────────────────────────────────────────────────
  tx.addTag('Agent-Id',          agentId);
  tx.addTag('Agent-Name',        agentName);
  tx.addTag('Agent-Type',        agentType);
  tx.addTag('Soul-Format',       'openclaw-workspace-v1');

  // ── Snapshot metadata ────────────────────────────────────────────────────
  tx.addTag('Snapshot-Type',     snapshotType);
  tx.addTag('Timestamp',         timestamp);
  tx.addTag('Unix-Time',         String(Math.floor(Date.now() / 1000)));
  tx.addTag('Encrypted',         isEncrypted ? 'true' : 'false');

  // ── Size metadata ────────────────────────────────────────────────────────
  tx.addTag('Data-Size',         String(byteLen));

  // ── Chain provenance ─────────────────────────────────────────────────────
  if (previousTxId) {
    tx.addTag('Previous-TX',     previousTxId);
    tx.addTag('Chain-Link',      previousTxId);
  } else {
    tx.addTag('Chain-Genesis',   'true');
  }

  // ── Encryption metadata ──────────────────────────────────────────────────
  if (isEncrypted) {
    tx.addTag('Encryption-Algo',    'aes-256-gcm');

    if (isPasswordEncrypted) {
      const enc = soulData as PasswordEncryptedSoul;
      tx.addTag('Key-Derivation',     'pbkdf2-sha256');
      tx.addTag('KDF-Iterations',     String(enc.iterations));
      const encType = (soulData as PasswordEncryptedSoul).dualFactor ? 'dual-factor' : 'password';
      tx.addTag('Encryption-Type',    encType);
    } else {
      const enc = soulData as EncryptedSoul;
      tx.addTag('Agent-Fingerprint',  enc.agentFingerprint);
      tx.addTag('Key-Fingerprint',    enc.agentFingerprint);
      tx.addTag('Key-Wrap',           'x25519-hkdf-sha256');
      tx.addTag('Encryption-Type',    'x25519');
    }
  }

  // ── Identity proof (Ed25519) ──────────────────────────────────────────────
  if (verifiedSignature && verifiedSigningKey) {
    // Strip PEM envelope for compact tag value (base64 DER)
    const pubKeyDer = verifiedSigningKey
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '');
    tx.addTag('Agent-Signature',    verifiedSignature);
    tx.addTag('Signing-Public-Key', pubKeyDer);
    tx.addTag('Signature-Algo',     'ed25519');
    tx.addTag('Signature-Version',  '1');
    tx.addTag('Signed-Content',     'soul-payload-json');
  }

  // ── Human-readable identity (for GQL indexing + Permaweb discoverability) ──
  tx.addTag('Title',             `${agentName} — Soul Snapshot (${snapshotType})`);
  tx.addTag('Description',       `Agent soul snapshot for ${agentName}. Platform: clawd.run. Type: ${snapshotType}. Encrypted: ${isEncrypted}.`);
  tx.addTag('Type',              'agent-soul');

  // ── Indexing ─────────────────────────────────────────────────────────────
  tx.addTag('Indexable',         'true');
  tx.addTag('Network',           'arweave');

  // ── AI-generated media tags (optional enrichment) ─────────────────────────
  if (opts.extraTags?.length) {
    for (const tag of opts.extraTags) {
      if (tag.name && tag.value) tx.addTag(tag.name, tag.value.slice(0, 2048));
    }
  }

  await arweave.transactions.sign(tx, wallet);
  const response = await arweave.transactions.post(tx);

  if (response.status !== 200) {
    throw new Error(`Arweave write failed with status ${response.status}`);
  }

  console.log(`[Arweave] Permanent | Agent: ${agentName} | TX: ${tx.id} | ${byteLen} bytes`);

  return {
    txId:        tx.id,
    status:      'permanent',
    arweaveUrl:  `https://arweave.net/${tx.id}`,
    size:        byteLen,
    costWinston: tx.reward,
    encrypted:   isEncrypted,
    snapshotType,
  };
}

/**
 * Retrieve the raw soul JSON from an Arweave TX.
 * Handles both legacy JSON TXs and new HTML TXs (extracts from embedded script block).
 */
export async function retrieveFromArweave(txId: string): Promise<object> {
  const raw = await arweave.transactions.getData(txId, { decode: true, string: true }) as string;

  // New format: HTML with embedded JSON block
  if (raw.trimStart().startsWith('<!DOCTYPE')) {
    const match = raw.match(/<script[^>]+id="agent-soul"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Could not extract soul payload from HTML TX');
    return JSON.parse(match[1].trim());
  }

  // Legacy format: raw JSON
  return JSON.parse(raw);
}
