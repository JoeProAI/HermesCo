// HermesCo - the agent's hands. Real code execution. The primary substrate is
// the agent's OWN dedicated Fly machine (a powerful, isolated, suspend-to-$0
// box the agent was spun up on) via the Fly Machines exec API. When Fly isn't
// configured it falls back to a fresh Daytona sandbox. No simulation: every run
// hits real infrastructure, captures real stdout/exit code.

import { getDaytona } from "@/lib/daytona";
import { ensureAgentBody, execOnMachine, flyConfigured } from "./fly";

export interface SandboxRun {
  ok: boolean;
  command: string;
  exitCode: number | null;
  output: string;
  sandboxId: string;
  substrate: "fly-machine" | "daytona";
  durationMs: number;
}

const MAX_OUTPUT_CHARS = 4000;
const DEFAULT_TIMEOUT_SEC = 60;

// Runs a command on the agent's own Fly machine when Fly is configured (lazily
// provisioning/resuming the body), otherwise on a fresh Daytona sandbox.
export async function runForAgent(
  workspaceId: string,
  command: string,
  opts: { timeoutSec?: number; goal?: string } = {},
): Promise<SandboxRun> {
  if (flyConfigured()) {
    const machine = await ensureAgentBody(workspaceId, opts.goal);
    const res = await execOnMachine(machine.id, command, { timeoutSec: opts.timeoutSec });
    const combined = res.stderr ? `${res.stdout}\n${res.stderr}` : res.stdout;
    return {
      ok: res.exitCode === 0,
      command,
      exitCode: res.exitCode,
      output: combined.slice(0, MAX_OUTPUT_CHARS),
      sandboxId: machine.id,
      substrate: "fly-machine",
      durationMs: res.durationMs,
    };
  }
  return runInSandbox(command, opts);
}

// Runs a shell command in a fresh, isolated Daytona sandbox and returns the
// real result. Throws if DAYTONA_API_KEY is not configured (no fake fallback).
export async function runInSandbox(
  command: string,
  opts: { timeoutSec?: number } = {},
): Promise<SandboxRun> {
  const daytona = getDaytona();
  const startedAt = Date.now();
  const sandbox = await daytona.create({
    autoStopInterval: 5,
    labels: { platform: "hermesco", purpose: "agent-sandbox" },
  });
  try {
    const root = (await sandbox.getUserRootDir()) || "/home/daytona";
    const res = await sandbox.process.executeCommand(
      command,
      root,
      undefined,
      opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
    );
    const stdout = String(res.artifacts?.stdout ?? res.result ?? "");
    return {
      ok: (res.exitCode ?? 0) === 0,
      command,
      exitCode: res.exitCode ?? null,
      output: stdout.slice(0, MAX_OUTPUT_CHARS),
      sandboxId: sandbox.id,
      substrate: "daytona",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    try {
      await sandbox.delete();
    } catch {
      // best-effort teardown; Daytona auto-stops idle sandboxes regardless
    }
  }
}
