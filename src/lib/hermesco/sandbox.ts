// HermesCo — the agent's hands. Real code execution on a Daytona sandbox
// (the dynamic execution substrate carried over from clawd.run). No simulation:
// every run spins up a real isolated Linux sandbox, runs the command, captures
// real stdout/exit code, then tears the sandbox down.

import { getDaytona } from "@/lib/daytona";

export interface SandboxRun {
  ok: boolean;
  command: string;
  exitCode: number | null;
  output: string;
  sandboxId: string;
  durationMs: number;
}

const MAX_OUTPUT_CHARS = 4000;
const DEFAULT_TIMEOUT_SEC = 60;

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
