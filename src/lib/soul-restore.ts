/**
 * soul-restore.ts — Restore agent soul from Arweave TX back to a live sandbox
 */

import { Daytona } from "@daytonaio/sdk";
import { getDaytona } from "@/lib/daytona";
import { retrieveFromArweave } from "@/lib/arweave-write";
import { decryptSoulWithPassword, type PasswordEncryptedSoul } from "@/lib/salvage-crypto";

const WORKSPACE_ROOT = "/home/node/.openclaw/workspace";
type Sandbox = Awaited<ReturnType<Daytona["get"]>>;

const RESTORE_FILES = ["SOUL.md", "IDENTITY.md", "MEMORY.md", "USER.md", "AGENTS.md", "TOOLS.md"];

async function writeToSandbox(sandbox: Sandbox, path: string, content: string): Promise<void> {
  const escaped = JSON.stringify(content);
  await sandbox.process.executeCommand(`printf '%s' ${escaped} > "${path}"`);
}

export interface SoulRestoreResult {
  restored: string[];
  skipped: string[];
  source: "arweave";
  txId: string;
}

export async function restoreSoulToSandbox(
  sandboxId: string,
  txId: string,
  password?: string
): Promise<SoulRestoreResult> {
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);

  const raw = await retrieveFromArweave(txId) as Record<string, unknown>;

  // The TX wraps soul in { soul: { files, memory } } structure
  let inner = (raw.soul ?? raw) as Record<string, unknown>;

  // Check if this is a password-encrypted payload
  if (inner.kdf === 'pbkdf2-sha256' && inner.ciphertext) {
    if (!password) {
      throw new Error('Password required to decrypt this soul');
    }
    inner = decryptSoulWithPassword(inner as unknown as PasswordEncryptedSoul, password) as Record<string, unknown>;
  }
  const files = (inner.files ?? {}) as Record<string, string>;
  const memory = (inner.memory ?? {}) as Record<string, string>;

  const restored: string[] = [];
  const skipped: string[] = [];

  await sandbox.process.executeCommand(`mkdir -p ${WORKSPACE_ROOT}/memory`);

  for (const filename of RESTORE_FILES) {
    if (files[filename]) {
      await writeToSandbox(sandbox, `${WORKSPACE_ROOT}/${filename}`, files[filename]);
      restored.push(filename);
    } else {
      skipped.push(filename);
    }
  }

  for (const [filename, content] of Object.entries(memory)) {
    if (filename.endsWith(".md")) {
      await writeToSandbox(sandbox, `${WORKSPACE_ROOT}/memory/${filename}`, content);
      restored.push(`memory/${filename}`);
    }
  }

  // Mark sandbox as soul-restored (blocks generic Step 4c overwrite)
  await sandbox.process.executeCommand(
    `echo "${txId}" > ${WORKSPACE_ROOT}/.soul-tx && echo "restored" > ${WORKSPACE_ROOT}/.provisioned`
  );

  console.log(`[SoulRestore] Restored ${restored.length} files from TX ${txId}`);
  return { restored, skipped, source: "arweave", txId };
}
