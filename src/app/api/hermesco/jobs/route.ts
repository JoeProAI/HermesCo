import { NextRequest, NextResponse } from "next/server";
import { fulfillJob, listJobs, quoteJob } from "@/lib/hermesco/jobs";
import { serviceCatalog } from "@/lib/hermesco/services";
import { getState } from "@/lib/hermesco/treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hermesco/jobs?workspaceId=demo -> the order book + service catalog.
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim() || "demo";
  try {
    const [jobs, state] = await Promise.all([listJobs(workspaceId), getState(workspaceId)]);
    return NextResponse.json({ jobs, services: serviceCatalog(), state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface JobsBody {
  workspaceId?: string;
  action?: "quote" | "deliver";
  // quote
  service?: string;
  brief?: string;
  priceUsd?: number;
  // deliver
  jobId?: string;
}

// POST /api/hermesco/jobs -> quote a new job, or deliver a paid one.
export async function POST(req: NextRequest) {
  let body: JobsBody;
  try {
    body = (await req.json()) as JobsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim() || "demo";
  const action = body.action;

  try {
    if (action === "quote") {
      if (!body.service?.trim() || !body.brief?.trim()) {
        return NextResponse.json({ error: "service and brief are required" }, { status: 400 });
      }
      const job = await quoteJob(workspaceId, {
        service: body.service.trim(),
        brief: body.brief.trim(),
        priceUsd: Number(body.priceUsd) || 0,
      });
      const state = await getState(workspaceId);
      return NextResponse.json({ job, state });
    }

    if (action === "deliver") {
      if (!body.jobId?.trim()) {
        return NextResponse.json({ error: "jobId is required" }, { status: 400 });
      }
      const result = await fulfillJob(workspaceId, body.jobId.trim());
      const state = await getState(workspaceId);
      return NextResponse.json({ ...result, state });
    }

    return NextResponse.json({ error: "action must be 'quote' or 'deliver'" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
