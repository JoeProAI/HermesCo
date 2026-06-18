import { NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/lib/hermesco/agent";
import type { ChatMessage } from "@/lib/hermesco/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AgentBody {
  workspaceId?: string;
  message?: string;
  history?: ChatMessage[];
}

export async function POST(req: NextRequest) {
  let body: AgentBody;
  try {
    body = (await req.json()) as AgentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const workspaceId = body.workspaceId?.trim() || "demo";
  try {
    const result = await runTurn({
      workspaceId,
      message,
      history: body.history,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
