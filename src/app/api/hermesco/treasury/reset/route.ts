import { NextRequest, NextResponse } from "next/server";
import { resetWorkspace } from "@/lib/hermesco/treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResetBody {
  workspaceId?: string;
}

export async function POST(req: NextRequest) {
  let body: ResetBody = {};
  try {
    body = (await req.json()) as ResetBody;
  } catch {
    // empty body is fine
  }
  const workspaceId = body.workspaceId?.trim() || "demo";
  try {
    const state = await resetWorkspace(workspaceId);
    return NextResponse.json(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
