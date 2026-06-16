import { NextRequest, NextResponse } from "next/server";
import { decide, getState } from "@/lib/hermesco/treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecideBody {
  workspaceId?: string;
  proposalId?: string;
  decision?: "approve" | "deny";
  operator?: string;
}

export async function POST(req: NextRequest) {
  let body: DecideBody;
  try {
    body = (await req.json()) as DecideBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim() || "demo";
  const proposalId = body.proposalId?.trim();
  const decision = body.decision;
  if (!proposalId) return NextResponse.json({ error: "proposalId is required" }, { status: 400 });
  if (decision !== "approve" && decision !== "deny") {
    return NextResponse.json({ error: "decision must be 'approve' or 'deny'" }, { status: 400 });
  }

  try {
    const proposal = await decide(workspaceId, proposalId, decision, body.operator);
    const state = await getState(workspaceId);
    return NextResponse.json({ proposal, state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
