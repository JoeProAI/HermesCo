/**
 * salvage-crypto.ts — X25519 dual-key envelope encryption for agent souls
 *
 * Ported from neural-salvage-service/src/crypto.js (pure Node.js crypto)
 * No external crypto dependencies — only Node.js built-ins.
 *
 * Design: AES-256-GCM for data encryption + X25519 ECDH key wrapping
 * Both the agent and platform owner can independently decrypt.
 */

import { createCipheriv, createDecipheriv, createHash, diffieHellman,
         generateKeyPairSync, hkdfSync, randomBytes, sign as cryptoSign,
         verify as cryptoVerify, createPrivateKey, createPublicKey,
         pbkdf2Sync } from 'crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AgentKeypair {
  encryption: { publicKey: string; privateKey: string };
  signing:    { publicKey: string; privateKey: string };
  fingerprint: string;
}

export interface KeyEnvelope {
  wrappedKey:           string; // base64
  iv:                   string; // base64
  authTag:              string; // base64
  ephemeralPublicKey:   string; // PEM
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv:         string; // base64
  authTag:    string; // base64
}

export interface EncryptedSoul {
  version:          string;
  encryption:       string;
  keyWrap:          string;
  payload:          EncryptedPayload;
  keys: {
    agent:  KeyEnvelope;
    owner:  KeyEnvelope | null;
  };
  agentFingerprint: string;
}

export interface PasswordEncryptedSoul {
  version:     string;
  encryption:  string;
  kdf:         string;
  iterations:  number;
  salt:        string;  // base64, 32 bytes
  iv:          string;  // base64, 12 bytes
  ciphertext:  string;  // base64
  authTag:     string;  // base64
  dualFactor?: boolean; // true if encrypted with password + soul entropy
}

// ─── Key generation ─────────────────────────────────────────────────────────

export function generateAgentKeypair(): AgentKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const { publicKey: signPub, privateKey: signPriv } = generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    encryption: { publicKey, privateKey },
    signing:    { publicKey: signPub, privateKey: signPriv },
    fingerprint: fingerprintKey(publicKey),
  };
}

export function fingerprintKey(publicKeyPem: string): string {
  return createHash('sha256')
    .update(publicKeyPem)
    .digest('hex')
    .slice(0, 16);
}

// ─── AES-256-GCM ────────────────────────────────────────────────────────────

function encryptAES(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    ciphertext: encrypted,
    iv:         iv.toString('base64'),
    authTag:    cipher.getAuthTag().toString('base64'),
  };
}

function decryptAES(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  let decrypted = decipher.update(payload.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── X25519 key wrapping ─────────────────────────────────────────────────────

function wrapKeyForRecipient(aesKey: Buffer, recipientPublicKeyPem: string): KeyEnvelope {
  const ephemeral = generateKeyPairSync('x25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(ephemeral.privateKey),
    publicKey:  createPublicKey(recipientPublicKeyPem),
  });

  const wrappingKey = Buffer.from(hkdfSync(
    'sha256',
    sharedSecret,
    Buffer.alloc(0),
    Buffer.from('neural-salvage-key-wrap-v1'),
    32
  ));

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
  let wrapped = cipher.update(aesKey);
  wrapped = Buffer.concat([wrapped, cipher.final()]);

  return {
    wrappedKey:         wrapped.toString('base64'),
    iv:                 iv.toString('base64'),
    authTag:            cipher.getAuthTag().toString('base64'),
    ephemeralPublicKey: ephemeral.publicKey,
  };
}

export function unwrapKey(envelope: KeyEnvelope, recipientPrivateKeyPem: string): Buffer {
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(recipientPrivateKeyPem),
    publicKey:  createPublicKey(envelope.ephemeralPublicKey),
  });

  const wrappingKey = Buffer.from(hkdfSync(
    'sha256',
    sharedSecret,
    Buffer.alloc(0),
    Buffer.from('neural-salvage-key-wrap-v1'),
    32
  ));

  const decipher = createDecipheriv(
    'aes-256-gcm',
    wrappingKey,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));

  let unwrapped = decipher.update(Buffer.from(envelope.wrappedKey, 'base64'));
  unwrapped = Buffer.concat([unwrapped, decipher.final()]);
  return unwrapped;
}

// ─── High-level: encrypt/decrypt a soul ─────────────────────────────────────

export function encryptSoul(
  soul: object,
  agentPublicKeyPem: string,
  ownerPublicKeyPem: string | null = null
): EncryptedSoul {
  const plaintext = JSON.stringify(soul);
  const aesKey    = randomBytes(32);

  const encrypted     = encryptAES(plaintext, aesKey);
  const agentEnvelope = wrapKeyForRecipient(aesKey, agentPublicKeyPem);
  const ownerEnvelope = ownerPublicKeyPem
    ? wrapKeyForRecipient(aesKey, ownerPublicKeyPem)
    : null;

  aesKey.fill(0); // zero out from memory

  return {
    version:    '1.0',
    encryption: 'aes-256-gcm',
    keyWrap:    'x25519-hkdf',
    payload:    encrypted,
    keys: { agent: agentEnvelope, owner: ownerEnvelope },
    agentFingerprint: fingerprintKey(agentPublicKeyPem),
  };
}

export function decryptSoul(
  envelope: EncryptedSoul,
  privateKeyPem: string,
  role: 'agent' | 'owner' = 'agent'
): object {
  const keyEnvelope = envelope.keys[role];
  if (!keyEnvelope) throw new Error(`No ${role} key envelope found`);

  const aesKey = unwrapKey(keyEnvelope, privateKeyPem);
  const plaintext = decryptAES(envelope.payload, aesKey);
  aesKey.fill(0);

  return JSON.parse(plaintext);
}

// ─── Password-based encryption (PBKDF2 + AES-256-GCM) ────────────────────────

const PBKDF2_ITERATIONS = 600000;
const PBKDF2_SALT_BYTES = 32;
const AES_IV_BYTES      = 12;

export function encryptSoulWithPassword(soul: object, password: string): PasswordEncryptedSoul {
  const plaintext = JSON.stringify(soul);
  const salt      = randomBytes(PBKDF2_SALT_BYTES);
  const iv        = randomBytes(AES_IV_BYTES);

  // Derive 256-bit key using PBKDF2-SHA256
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  key.fill(0); // zero out from memory

  return {
    version:    '1.0',
    encryption: 'aes-256-gcm',
    kdf:        'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt:       salt.toString('base64'),
    iv:         iv.toString('base64'),
    ciphertext: encrypted,
    authTag:    cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSoulWithPassword(encrypted: PasswordEncryptedSoul, password: string): object {
  const salt = Buffer.from(encrypted.salt, 'base64');
  const iv   = Buffer.from(encrypted.iv, 'base64');

  // Derive key using same parameters
  const key = pbkdf2Sync(password, salt, encrypted.iterations, 32, 'sha256');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

  let decrypted = decipher.update(encrypted.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  key.fill(0); // zero out from memory

  return JSON.parse(decrypted);
}

// ─── Ed25519 signing (identity proof) ────────────────────────────────────────

export function signData(data: string, signingPrivateKeyPem: string): string {
  return cryptoSign(null, Buffer.from(data), signingPrivateKeyPem).toString('base64');
}

export function verifySignature(
  data: string,
  signature: string,
  signingPublicKeyPem: string
): boolean {
  return cryptoVerify(
    null,
    Buffer.from(data),
    signingPublicKeyPem,
    Buffer.from(signature, 'base64')
  );
}

// ─── Dual-factor: password + soul entropy ──────────────────────────────────

const SOUL_ENTROPY_BYTES = 16; // 128 bits

/**
 * Generate random soul entropy (128 bits).
 * This is given to the user as a backup recovery factor.
 * Displayed as a formatted hex string (4-char groups for readability).
 */
export function generateSoulEntropy(): { raw: Buffer; display: string } {
  const raw = randomBytes(SOUL_ENTROPY_BYTES);
  // Format as 4-char hex groups: "a1b2 c3d4 e5f6 7890 ..."
  const hex = raw.toString('hex');
  const display = hex.match(/.{4}/g)!.join(' ');
  return { raw, display };
}

/**
 * Encrypt soul with dual-factor: password + soul entropy.
 * Key = PBKDF2(password || entropy, salt, 600k, sha256)
 * 
 * Even a weak password is secure because the entropy alone is 2^128 combinations.
 * Attacker needs BOTH factors to derive the key.
 */
export function encryptSoulDualFactor(
  soul: object,
  password: string,
  soulEntropy: Buffer
): PasswordEncryptedSoul {
  const plaintext = JSON.stringify(soul);
  const salt      = randomBytes(PBKDF2_SALT_BYTES);
  const iv        = randomBytes(AES_IV_BYTES);

  // Combine password + entropy as the PBKDF2 input
  const combined = Buffer.concat([Buffer.from(password, 'utf8'), soulEntropy]);
  const key = pbkdf2Sync(combined, salt, PBKDF2_ITERATIONS, 32, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  // Zero sensitive material
  key.fill(0);
  combined.fill(0);

  return {
    version:    '1.0',
    encryption: 'aes-256-gcm',
    kdf:        'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt:       salt.toString('base64'),
    iv:         iv.toString('base64'),
    ciphertext: encrypted,
    authTag,
    dualFactor: true,
  };
}

/**
 * Decrypt a dual-factor encrypted soul.
 */
export function decryptSoulDualFactor(
  encrypted: PasswordEncryptedSoul & { dualFactor?: boolean },
  password: string,
  soulEntropy: Buffer
): object {
  const salt = Buffer.from(encrypted.salt, 'base64');
  const iv   = Buffer.from(encrypted.iv,   'base64');
  const iterations = encrypted.iterations || PBKDF2_ITERATIONS;

  const combined = Buffer.concat([Buffer.from(password, 'utf8'), soulEntropy]);
  const key = pbkdf2Sync(combined, salt, iterations, 32, 'sha256');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (encrypted.authTag) {
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  }

  let decrypted = decipher.update(encrypted.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  // Zero sensitive material
  key.fill(0);
  combined.fill(0);

  return JSON.parse(decrypted);
}
