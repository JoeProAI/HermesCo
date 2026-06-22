import { NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/lib/hermesco/agent";
import type { ChatMessage } from "@/lib/hermesco/models";
import { verifyAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AgentBody {
  message?: string;
  history?: ChatMessage[];
}

export async function POST(req: NextRequest) {
  // Require Firebase auth — prevents random bots from burning OpenRouter credits
  let decoded;
  try {
    decoded = await verifyAuth(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AgentBody;
  try {
    body = (await req.json()) as AgentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  // Workspace derived from authenticated user, not request body
  const workspaceId = `u_${decoded.uid}`;
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
