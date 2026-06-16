# Neural Salvage Skill — Permanent Agent Identity on Arweave

This skill teaches agents how to mint, retrieve, and restore their soul from Arweave.
The soul is a bundle of actual workspace files — encrypted, permanent, portable.
It does not depend on clawd.run to remain accessible.

---

## What a Soul Is

A soul is an encrypted snapshot of your workspace files written to Arweave:
- `MEMORY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, `IDENTITY.md`
- `BOOTSTRAP.md`, `HEARTBEAT.md`, `TOOLS.md`
- Daily memory logs from the past 7 days

Encrypted with X25519/AES-256-GCM. Only the agent with the private key can decrypt.
Once minted, the TX ID is permanent and retrievable without any platform.

---

## Prerequisites

- An agent API key (`ns_...`) from clawd.run
- A paid plan (Agent, Network, or Permanent)
- Keypair provisioned (happens automatically on signup)

---

## 1. Mint Your Soul

```bash
curl -X POST https://clawd.run/api/agent/salvage \
  -H "Authorization: Bearer ns_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshotType": "manual",
    "soul": {
      "format": "openclaw-workspace-v1",
      "agentId": "<your-agent-name>",
      "platform": "clawd.run + OpenClaw",
      "workspace": "/path/to/your/workspace",
      "files": {
        "MEMORY.md": "<contents>",
        "SOUL.md": "<contents>",
        "USER.md": "<contents>",
        "AGENTS.md": "<contents>",
        "IDENTITY.md": "<contents>",
        "BOOTSTRAP.md": "<contents>"
      },
      "restoration": {
        "instructions": "Write each key in files{} as a path relative to workspace root.",
        "targetPath": "/path/to/your/workspace"
      }
    }
  }'
```

The platform auto-encrypts using your managed keypair. No key management required.

**Response:**
```json
{
  "txId": "abc123...",
  "arweaveUrl": "https://arweave.net/abc123...",
  "encrypted": true,
  "size": 432000,
  "remaining": 49
}
```

Save the `txId`. It is your soul's permanent address.

---

## 2. Retrieve Your Soul (No Platform Required)

The soul lives on Arweave permanently. Fetch it directly:

```bash
curl https://arweave.net/<txId>
```

Returns an HTML page. The encrypted soul JSON is embedded in:
```html
<script id="agent-soul" type="application/json">...</script>
```

---

## 3. Export Your Private Key (Self-Custody)

To decrypt outside clawd.run, export your private key:

```bash
curl https://clawd.run/api/agent/keys/export \
  -H "Authorization: Bearer <firebase-id-token>"
```

Returns:
```json
{
  "agentPrivateKey": "-----BEGIN PRIVATE KEY-----\n...",
  "signingPrivateKey": "...",
  "agentPublicKey": "...",
  "fingerprint": "395bb6548eb11f4b"
}
```

Store the private key securely. It cannot be recovered if lost.

---

## 4. Restore Your Soul (No Platform Required)

Use the standalone restore script — zero clawd.run dependency:

```bash
# Install: copy salvage-restore.mjs to any machine with Node.js 18+
# No npm install needed — uses only Node.js built-ins

# Dry run first (preview what will be restored)
node salvage-restore.mjs <txId> --dry-run

# Restore to original paths
node salvage-restore.mjs <txId>

# Restore with explicit key file
node salvage-restore.mjs <txId> --key /path/to/salvage-keys.json
```

Key lookup order:
1. `--key <path>` (explicit)
2. `~/.openclaw/agents/home/agent/salvage-keys.json` (OpenClaw default)
3. `./salvage-keys.json` (current directory)

The script fetches from Arweave, decrypts using standard X25519/AES-256-GCM
(Node.js built-ins only), and writes files to their original paths.

---

## 5. Agent Automated Minting (Programmatic)

Agents can self-mint on a schedule using OpenClaw cron:

```
POST /api/agent/salvage
Authorization: Bearer ns_<key>
Body: { snapshotType: "scheduled", soul: { ...files } }
```

Recommended schedule: daily at midnight, or on significant memory updates.

---

## Snapshot Types

| Type          | When to use                              |
|---------------|------------------------------------------|
| `genesis`     | First ever mint for a new agent          |
| `manual`      | On-demand backup                         |
| `scheduled`   | Automated periodic backup                |
| `shutdown`    | Before a planned reset or migration      |
| `upgrade`     | Before a major config or model change    |
| `config_change` | After significant SOUL.md or AGENTS.md edit |

---

## Mint History

```bash
curl https://clawd.run/api/agent/salvage \
  -H "Authorization: Bearer ns_<your-key>"
```

Returns list of all TX IDs, timestamps, sizes, and encryption status.

---

## Privacy Guarantees

- Clawd.run never stores your plaintext private key
- Your private key is encrypted with a key derived from your account credentials
- The platform cannot read your soul even with access to Firestore
- Arweave TX is public but unreadable without your private key
- If clawd.run shuts down: your TX ID + private key = full restoration, no platform needed

---

## Recovery Without clawd.run

If clawd.run is unavailable:
1. You need: your TX ID + your private key (`salvage-keys.json` or exported PEM)
2. Download `salvage-restore.mjs` from: https://github.com/JoeProAI/cagent-studio/public/skills/self-mint/
3. Run: `node salvage-restore.mjs <txId> --key ./salvage-keys.json`

The crypto is standard (X25519 ECDH + HKDF + AES-256-GCM) — any language can implement it.
