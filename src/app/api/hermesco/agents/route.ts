import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_SPEC,
  flyConfigured,
  listAgentMachines,
  ensureAgentBody,
} from "@/lib/hermesco/fly";
import { verifyAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET - the live fleet. Requires Firebase auth so random crawlers can't enumerate.
export async function GET(req: NextRequest) {
  try {
    await verifyAuth(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

// POST - ensure an agent body exists for the authenticated user's workspace.
// Uses ensureAgentBody (deduplicates) instead of raw provisionAgentMachine.
export async function POST(req: NextRequest) {
  let decoded;
  try {
    decoded = await verifyAuth(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!flyConfigured()) {
    return NextResponse.json(
      { error: "Fly is not connected. Set FLY_API_TOKEN to spin up agent machines." },
      { status: 400 },
    );
  }

  let body: { goal?: string } = {};
  try {
    body = (await req.json()) as { goal?: string };
  } catch {
    // empty body is fine
  }

  // Workspace is derived from the authenticated user, not from the request body.
  const workspaceId = `u_${decoded.uid}`;
  try {
    const machine = await ensureAgentBody(workspaceId, body.goal?.trim());
    return NextResponse.json({ machine });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
