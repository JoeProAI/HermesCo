import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_SPEC,
  flyConfigured,
  listAgentMachines,
  provisionAgentMachine,
} from "@/lib/hermesco/fly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProvisionBody {
  agentId?: string;
  label?: string;
  goal?: string;
  workspaceId?: string;
}

// GET - the live fleet: every real Fly agent machine HermesCo has spun up.
export async function GET() {
  if (!flyConfigured()) {
    return NextResponse.json({ configured: false, spec: AGENT_SPEC, machines: [] });
  }
  try {
    const machines = await listAgentMachines();
    return NextResponse.json({ configured: true, spec: AGENT_SPEC, machines });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST - spin up a new dedicated, powerful Fly machine as an agent body.
export async function POST(req: NextRequest) {
  if (!flyConfigured()) {
    return NextResponse.json(
      { error: "Fly is not connected. Set FLY_API_TOKEN to spin up agent machines." },
      { status: 400 },
    );
  }
  let body: ProvisionBody = {};
  try {
    body = (await req.json()) as ProvisionBody;
  } catch {
    // empty body is fine - provision with defaults
  }
  try {
    const machine = await provisionAgentMachine({
      agentId: body.agentId?.trim() || undefined,
      label: body.label?.trim() || undefined,
      goal: body.goal?.trim() || undefined,
      workspaceId: body.workspaceId?.trim() || undefined,
    });
    return NextResponse.json({ machine });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
