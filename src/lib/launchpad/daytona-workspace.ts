/**
 * Launchpad Daytona workspace — one sandbox per launchpad user.
 *
 * The Fly machine stays the chat/dashboard coordinator; this sandbox is the
 * muscle: it holds the agent's project files and runs build/serve tasks with
 * public preview URLs (sandbox is created with `public: true`, so preview
 * links on ports 3000-9999 work with a single click, no token juggling).
 *
 * Lifecycle: create on first use, persist the sandbox id on the
 * launchpad_users doc, reuse thereafter. Daytona's native autoStopInterval
 * stops idle sandboxes so a forgotten dev server does not burn credits.
 */

import { Daytona } from "@daytonaio/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { getDaytona } from "@/lib/daytona";
import { isSandboxReplacementError } from "@/lib/daytona-sandbox";

type DaytonaSandboxHandle = Awaited<ReturnType<Daytona["get"]>>;

/** Minutes of inactivity before Daytona auto-stops the sandbox. */
const AUTO_STOP_MINUTES = 15;

/** Shape persisted at launchpad_users/{uid}.daytonaSandbox */
export interface LaunchpadSandboxRecord {
  sandboxId: string;
  workspaceRoot: string;
  createdAt: string;
  lastActiveAt: string;
  lastTickAt?: string;
}

export interface ResolvedLaunchpadSandbox {
  sandbox: DaytonaSandboxHandle;
  sandboxId: string;
  workspaceRoot: string;
  created: boolean;
}

function userDocRef(userId: string) {
  return getAdminDb().collection("launchpad_users").doc(userId);
}

export async function readLaunchpadSandboxRecord(
  userId: string
): Promise<LaunchpadSandboxRecord | null> {
  const snap = await userDocRef(userId).get();
  const record = snap.data()?.daytonaSandbox as
    | LaunchpadSandboxRecord
    | undefined;
  return record?.sandboxId ? record : null;
}

async function createLaunchpadSandbox(
  daytona: Daytona,
  userId: string
): Promise<ResolvedLaunchpadSandbox> {
  const sandbox = await daytona.create({
    public: true,
    autoStopInterval: AUTO_STOP_MINUTES,
    labels: {
      platform: "clawd.run",
      purpose: "launchpad-workspace",
      "user-id": userId,
    },
  });

  const rootDir = (await sandbox.getUserRootDir()) || "/home/daytona";
  const workspaceRoot = `${rootDir.replace(/\/$/, "")}/workspace`;
  await sandbox.process.executeCommand(`mkdir -p "${workspaceRoot}"`);

  const nowIso = new Date().toISOString();
  const record: LaunchpadSandboxRecord = {
    sandboxId: sandbox.id,
    workspaceRoot,
    createdAt: nowIso,
    lastActiveAt: nowIso,
  };
  await userDocRef(userId).set(
    { daytonaSandbox: record, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { sandbox, sandboxId: sandbox.id, workspaceRoot, created: true };
}

/**
 * Resolve (and start) the launchpad user's Daytona sandbox.
 * Creates one on first use; recovers transparently if the stored
 * sandbox was deleted/replaced server-side.
 */
export async function resolveLaunchpadSandbox(
  userId: string,
  options: { createIfMissing?: boolean } = {}
): Promise<ResolvedLaunchpadSandbox | null> {
  const { createIfMissing = true } = options;
  const daytona = getDaytona();
  const record = await readLaunchpadSandboxRecord(userId);

  if (record) {
    try {
      const sandbox = await daytona.get(record.sandboxId);
      if (sandbox.state !== "started") {
        await sandbox.start();
      }
      await touchLaunchpadSandbox(userId);
      return {
        sandbox,
        sandboxId: record.sandboxId,
        workspaceRoot: record.workspaceRoot,
        created: false,
      };
    } catch (error) {
      if (!isSandboxReplacementError(error)) throw error;
      // Stored sandbox is gone; fall through to recreate.
    }
  }

  if (!createIfMissing) return null;
  return createLaunchpadSandbox(daytona, userId);
}

export async function touchLaunchpadSandbox(userId: string): Promise<void> {
  await userDocRef(userId).set(
    {
      daytonaSandbox: { lastActiveAt: new Date().toISOString() },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function stopLaunchpadSandbox(userId: string): Promise<boolean> {
  const record = await readLaunchpadSandboxRecord(userId);
  if (!record) return false;
  const daytona = getDaytona();
  try {
    const sandbox = await daytona.get(record.sandboxId);
    if (sandbox.state === "started") {
      await sandbox.stop();
    }
    return true;
  } catch (error) {
    if (isSandboxReplacementError(error)) return false;
    throw error;
  }
}

/** Non-starting state probe for dashboards and the usage cron. */
export async function launchpadSandboxState(
  userId: string
): Promise<{ sandboxId: string; state: string } | null> {
  const record = await readLaunchpadSandboxRecord(userId);
  if (!record) return null;
  const daytona = getDaytona();
  try {
    const sandbox = await daytona.get(record.sandboxId);
    return { sandboxId: record.sandboxId, state: String(sandbox.state || "unknown") };
  } catch (error) {
    if (isSandboxReplacementError(error)) return null;
    throw error;
  }
}

/**
 * Guard: path must stay inside the workspace root — no traversal and no
 * shell metacharacters (paths get interpolated into sandbox shell commands;
 * call sites must additionally wrap them with shellQuote).
 */
export function isInsideWorkspace(workspaceRoot: string, path: string): boolean {
  if (path.includes("..") || path.includes("//")) return false;
  if (/[`$\\"'!;&|<>(){}\[\]*?~\n\r\t]/.test(path)) return false;
  return path === workspaceRoot || path.startsWith(`${workspaceRoot}/`);
}

/** Single-quote a value for safe interpolation into a POSIX shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
