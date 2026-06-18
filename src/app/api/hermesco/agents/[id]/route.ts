import { NextRequest, NextResponse } from "next/server";
import {
  destroyAgentMachine,
  execOnMachine,
  flyConfigured,
  getAgentMachine,
  startAgentMachine,
  suspendAgentMachine,
} from "@/lib/hermesco/fly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActionBody {
  action?: "suspend" | "start" | "exec";
  command?: string;
  timeoutSec?: number;
}

function notConfigured() {
  return NextResponse.json(
    { error: "Fly is not connected. Set FLY_API_TOKEN to manage agent machines." },
    { status: 400 },
  );
}

// GET - live status + vitals of one agent machine.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!flyConfigured()) return notConfigured();
  const { id } = await ctx.params;
  try {
    const machine = await getAgentMachine(id);
    if (!machine) return NextResponse.json({ error: "Machine not found" }, { status: 404 });
    return NextResponse.json({ machine });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST - act on the machine: suspend (to $0), start (warm resume), or exec
// a real command on the agent's own body.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!flyConfigured()) return notConfigured();
  const { id } = await ctx.params;
  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "suspend") {
      await suspendAgentMachine(id);
      return NextResponse.json({ ok: true, machine: await getAgentMachine(id) });
    }
    if (body.action === "start") {
      await startAgentMachine(id);
      return NextResponse.json({ ok: true, machine: await getAgentMachine(id) });
    }
    if (body.action === "exec") {
      const command = (body.command ?? "").trim();
      if (!command) {
        return NextResponse.json({ error: "command is required for exec" }, { status: 400 });
      }
      const result = await execOnMachine(id, command, { timeoutSec: body.timeoutSec });
      return NextResponse.json({ ok: result.exitCode === 0, result });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE - destroy the agent machine (cleanup).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!flyConfigured()) return notConfigured();
  const { id } = await ctx.params;
  try {
    await destroyAgentMachine(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
