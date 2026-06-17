import { NextRequest, NextResponse } from "next/server";
import { getState, recordDeposit } from "@/lib/hermesco/treasury";
import {
  createDepositCheckout,
  retrieveDepositCheckout,
  stripeConfigured,
} from "@/lib/hermesco/stripe-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DepositBody {
  workspaceId?: string;
  amountUsd?: number;
}

function originOf(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  return req.nextUrl.origin;
}

// POST - start a real Stripe Checkout to deposit capital into the Treasury.
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not connected. Set STRIPE_SECRET_KEY to enable deposits." },
      { status: 400 },
    );
  }

  let body: DepositBody;
  try {
    body = (await req.json()) as DepositBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim() || "demo";
  const amountUsd = Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1) {
    return NextResponse.json({ error: "amountUsd must be at least $1" }, { status: 400 });
  }

  const origin = originOf(req);
  try {
    const checkout = await createDepositCheckout({
      amountUsd,
      workspaceId,
      successUrl: `${origin}/command?deposit_session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/command?deposit_cancelled=1`,
    });
    return NextResponse.json(checkout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET - confirm a returned Checkout session and credit the Treasury (idempotent).
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim();
  const workspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim() || "demo";
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const confirmation = await retrieveDepositCheckout(sessionId);
    if (!confirmation.paid) {
      return NextResponse.json(
        { ok: false, paid: false, state: await getState(workspaceId) },
        { status: 200 },
      );
    }
    if (confirmation.workspaceId && confirmation.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "This deposit belongs to a different workspace." },
        { status: 403 },
      );
    }
    const result = await recordDeposit(workspaceId, {
      amountUsd: confirmation.amountUsd,
      stripeRef: sessionId,
      description: "Treasury deposit (Stripe Checkout)",
    });
    return NextResponse.json({
      ok: true,
      paid: true,
      duplicate: result.duplicate,
      depositedUsd: confirmation.amountUsd,
      state: result.state,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
