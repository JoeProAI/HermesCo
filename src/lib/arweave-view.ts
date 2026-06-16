/**
 * arweave-view.ts — Build the HTML "face" for an Arweave agent TX
 *
 * Returns a self-contained HTML page that:
 *  - Renders the agent's deterministic hex-grid sigil
 *  - Shows agent metadata (name, ID, type, tier, snapshot type, timestamp)
 *  - Shows the TX chain (links to Previous-TX if present)
 *  - Embeds the raw JSON soul payload for machine extraction
 *  - Links back to clawd.run
 *
 * This IS the TX data (Content-Type: text/html).
 * arweave.net/<txId> renders this page directly.
 */

import { buildAgentSigil } from './agent-sigil';

export interface AgentViewOptions {
  agentId:           string;
  agentName:         string;
  agentType:         string;
  snapshotType:      string;
  timestamp:         string;
  encrypted:         boolean;
  passwordEncrypted?: boolean;  // true if PBKDF2+AES-GCM password encryption
  previousTxId?:     string;
  soulPayload:       object;    // the full JSON payload — embedded in <script>
}

export function buildArweaveView(opts: AgentViewOptions): string {
  const {
    agentId, agentName, agentType, snapshotType,
    timestamp, encrypted, passwordEncrypted, previousTxId, soulPayload,
  } = opts;

  const sigil      = buildAgentSigil(agentId);
  const date       = new Date(timestamp).toUTCString();
  const shortId    = agentId.length > 24 ? agentId.slice(0, 12) + '…' + agentId.slice(-6) : agentId;
  const soulJson   = JSON.stringify(soulPayload, null, 2);
  const prevBlock  = previousTxId
    ? `<a class="chain-link" href="https://arweave.net/${previousTxId}" target="_blank" rel="noopener">
         ↩ Previous snapshot → ${previousTxId.slice(0, 10)}…
       </a>`
    : `<span class="chain-link dim">genesis snapshot — no previous TX</span>`;

  const typeLabel: Record<string, string> = {
    genesis:       'Genesis',
    scheduled:     'Scheduled',
    shutdown:      'Shutdown',
    manual:        'Manual',
    config_change: 'Config Change',
    upgrade:       'Upgrade',
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${agentName} — Agent Soul on Arweave</title>
<style>
  :root {
    --bg:     #080810;
    --card:   #0f0f1a;
    --border: #1e1e30;
    --text:   #c8c8d8;
    --dim:    #555568;
    --accent: #7c6fcd;
    --mono:   'Fira Mono', 'Cascadia Code', 'Menlo', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, 'Segoe UI', sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px 60px;
  }

  /* ── header ── */
  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
  }
  .sigil-wrap {
    filter: drop-shadow(0 0 18px rgba(120, 100, 220, 0.25));
  }
  .agent-name {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #e8e8f8;
  }
  .agent-sub {
    font-size: 13px;
    color: var(--dim);
    font-family: var(--mono);
    letter-spacing: 0.5px;
  }

  /* ── card ── */
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 28px;
    width: 100%;
    max-width: 520px;
    margin-bottom: 16px;
  }
  .card-title {
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--dim);
    margin-bottom: 16px;
  }

  /* ── metadata grid ── */
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 24px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 3px; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); }
  .meta-value { font-size: 13px; color: var(--text); font-family: var(--mono); word-break: break-all; }
  .meta-value.wide { grid-column: 1 / -1; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 11px;
    font-family: var(--mono);
    border: 1px solid var(--border);
  }
  .badge.encrypted  { color: #6ec97a; border-color: #2a4a2e; background: #0d1f10; }
  .badge.plain      { color: var(--dim); }
  .badge.genesis    { color: #c9a96e; border-color: #3d2e10; background: #1a1300; }
  .badge.snapshot   { color: #6eb5c9; border-color: #10303d; background: #001318; }

  /* ── chain ── */
  .chain-link {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    word-break: break-all;
  }
  .chain-link:hover { text-decoration: underline; }
  .chain-link.dim   { color: var(--dim); }

  /* ── raw data toggle ── */
  .raw-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    color: var(--dim);
    font-size: 12px;
    font-family: var(--mono);
    cursor: pointer;
    margin-top: 4px;
    transition: color 0.15s, border-color 0.15s;
  }
  .raw-toggle:hover { color: var(--text); border-color: var(--accent); }
  .raw-data {
    display: none;
    margin-top: 14px;
    background: #060609;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    font-family: var(--mono);
    font-size: 11px;
    color: #889;
    white-space: pre;
    overflow-x: auto;
    max-height: 340px;
    overflow-y: auto;
  }
  .raw-data.open { display: block; }

  /* ── footer ── */
  .footer {
    margin-top: 32px;
    font-size: 11px;
    color: var(--dim);
    text-align: center;
    line-height: 1.8;
  }
  .footer a { color: var(--accent); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
  .perma-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border: 1px solid #1a2a1a;
    border-radius: 99px;
    background: #0a1a0a;
    color: #6ec97a;
    font-size: 11px;
    font-family: var(--mono);
    margin-bottom: 12px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #6ec97a;
         box-shadow: 0 0 6px #6ec97a; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* ── decrypt UI ── */
  .decrypt-form {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .decrypt-input {
    flex: 1;
    min-width: 180px;
    padding: 10px 14px;
    background: #060609;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
  }
  .decrypt-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .decrypt-btn {
    padding: 10px 18px;
    background: linear-gradient(135deg, #4a3d8c, #6b5acd);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-family: var(--mono);
    font-size: 12px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .decrypt-btn:hover { opacity: 0.9; }
  .decrypt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .decrypt-error {
    width: 100%;
    margin-top: 10px;
    padding: 10px 14px;
    background: #1a0a0a;
    border: 1px solid #3d1010;
    border-radius: 6px;
    color: #c96e6e;
    font-size: 12px;
    display: none;
  }
  .decrypt-error.show { display: block; }

  /* ── decrypted files viewer ── */
  .files-viewer { margin-top: 16px; display: none; }
  .files-viewer.show { display: block; }
  .file-section {
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .file-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #0a0a14;
    cursor: pointer;
    user-select: none;
  }
  .file-header:hover { background: #0d0d18; }
  .file-name {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent);
  }
  .file-toggle {
    font-size: 10px;
    color: var(--dim);
  }
  .file-content {
    display: none;
    padding: 14px;
    background: #060609;
    font-family: var(--mono);
    font-size: 11px;
    color: #889;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
  }
  .file-content.open { display: block; }
</style>
</head>
<body>

<div class="header">
  <div class="sigil-wrap">${sigil}</div>
  <div class="agent-name">${escapeHtml(agentName)}</div>
  <div class="agent-sub">${shortId}</div>
</div>

<div class="card">
  <div class="card-title">Identity</div>
  <div class="meta-grid">
    <div class="meta-item">
      <span class="meta-label">Agent ID</span>
      <span class="meta-value">${escapeHtml(agentId)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Type</span>
      <span class="meta-value">${escapeHtml(agentType)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Snapshot</span>
      <span class="meta-value">
        <span class="badge ${snapshotType === 'genesis' ? 'genesis' : 'snapshot'}">
          ${typeLabel[snapshotType] ?? snapshotType}
        </span>
      </span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Encryption</span>
      <span class="meta-value">
        <span class="badge ${encrypted ? 'encrypted' : 'plain'}">${encrypted ? '🔒 encrypted' : 'plaintext'}</span>
      </span>
    </div>
    <div class="meta-item" style="grid-column:1/-1">
      <span class="meta-label">Minted</span>
      <span class="meta-value">${date}</span>
    </div>
  </div>
</div>

<div class="card">
  <div class="card-title">Chain</div>
  ${prevBlock}
</div>

${passwordEncrypted ? `
<div class="card" id="decrypt-card">
  <div class="card-title">Decrypt Soul</div>
  <div class="decrypt-form">
    <input type="password" class="decrypt-input" id="soul-password" placeholder="Enter soul password..." autocomplete="off">
    <input type="text" class="decrypt-input" id="soul-entropy" placeholder="Soul salt (hex groups, e.g. a1b2 c3d4 ...)" autocomplete="off" style="display:none; font-family: var(--mono); letter-spacing: 1px;">
    <button class="decrypt-btn" id="decrypt-btn" onclick="decryptSoul()">Decrypt</button>
  </div>
  <div class="decrypt-error" id="decrypt-error"></div>
  <div class="files-viewer" id="files-viewer"></div>
</div>
` : ''}

<div class="card">
  <div class="card-title">Raw Payload</div>
  <button class="raw-toggle" onclick="this.nextElementSibling.classList.toggle('open');this.textContent=this.nextElementSibling.classList.contains('open')?'hide payload ↑':'show payload ↓'">
    show payload ↓
  </button>
  <pre class="raw-data">${escapeHtml(soulJson)}</pre>
</div>

<div class="footer">
  <div class="perma-badge"><span class="dot"></span> permanently stored on Arweave</div><br>
  Minted by <a href="https://clawd.run" target="_blank" rel="noopener">clawd.run</a> —
  permanent identity infrastructure for AI agents.<br>

</div>

<script type="application/json" id="agent-soul">
${soulJson}
</script>

${passwordEncrypted ? `
<script type="application/json" id="encrypted-soul">
${JSON.stringify((soulPayload as Record<string, unknown>).soul)}
</script>

<script>
async function decryptSoul() {
  const btn = document.getElementById('decrypt-btn');
  const errorEl = document.getElementById('decrypt-error');
  const viewerEl = document.getElementById('files-viewer');
  const passwordEl = document.getElementById('soul-password');
  const password = passwordEl.value;

  if (!password) {
    errorEl.textContent = 'Please enter a password';
    errorEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Decrypting...';
  errorEl.classList.remove('show');

  try {
    const encrypted = JSON.parse(document.getElementById('encrypted-soul').textContent);
    const salt = Uint8Array.from(atob(encrypted.salt), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0));
    const authTag = Uint8Array.from(atob(encrypted.authTag), c => c.charCodeAt(0));

    // Combine ciphertext + authTag for WebCrypto
    const combined = new Uint8Array(ciphertext.length + authTag.length);
    combined.set(ciphertext);
    combined.set(authTag, ciphertext.length);

    // Build key input: password alone, or password + soul entropy for dual-factor
    const enc = new TextEncoder();
    let keyInput;
    if (encrypted.dualFactor) {
      const entropyHex = document.getElementById('soul-entropy').value.replace(/\\s+/g, '');
      if (!entropyHex || entropyHex.length !== 32) {
        throw new Error('Soul salt required (32 hex characters)');
      }
      const entropyBytes = new Uint8Array(entropyHex.match(/.{2}/g).map(b => parseInt(b, 16)));
      const pwBytes = enc.encode(password);
      keyInput = new Uint8Array(pwBytes.length + entropyBytes.length);
      keyInput.set(pwBytes);
      keyInput.set(entropyBytes, pwBytes.length);
    } else {
      keyInput = enc.encode(password);
    }

    // Derive key using PBKDF2-SHA256
    const keyMaterial = await crypto.subtle.importKey(
      'raw', keyInput, 'PBKDF2', false, ['deriveBits', 'deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: encrypted.iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      combined
    );

    const soul = JSON.parse(new TextDecoder().decode(decrypted));
    renderDecryptedSoul(soul);
    btn.textContent = 'Decrypted';
  } catch (e) {
    errorEl.textContent = 'Decryption failed — incorrect password or corrupted data';
    errorEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Decrypt';
  }
}

function renderDecryptedSoul(soul) {
  const viewer = document.getElementById('files-viewer');
  viewer.innerHTML = '';

  const sections = [
    { key: 'files', label: 'Soul Files' },
    { key: 'memory', label: 'Memory' },
    { key: 'skills', label: 'Skills' },
    { key: 'credentials', label: 'Credentials' }
  ];

  for (const section of sections) {
    const data = soul[section.key];
    if (!data || Object.keys(data).length === 0) continue;

    for (const [filename, content] of Object.entries(data)) {
      const el = document.createElement('div');
      el.className = 'file-section';
      el.innerHTML = \`
        <div class="file-header" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.file-toggle').textContent=this.nextElementSibling.classList.contains('open')?'collapse':'expand'">
          <span class="file-name">\${escapeHtml(filename)}</span>
          <span class="file-toggle">expand</span>
        </div>
        <pre class="file-content">\${escapeHtml(String(content))}</pre>
      \`;
      viewer.appendChild(el);
    }
  }

  viewer.classList.add('show');
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Show soul entropy field if dual-factor
try {
  const enc = JSON.parse(document.getElementById('encrypted-soul').textContent);
  if (enc.dualFactor) {
    document.getElementById('soul-entropy').style.display = 'block';
  }
} catch(e) {}

// Enter key triggers decrypt
document.getElementById('soul-password').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') decryptSoul();
});
document.getElementById('soul-entropy').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') decryptSoul();
});
</script>
` : ''}

</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
