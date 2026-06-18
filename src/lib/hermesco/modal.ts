// HermesCo - the Modal GPU client. This is how the agent autonomously rents a
// REAL cloud GPU from an external vendor (Modal) per job. HermesCo POSTs the
// customer's brief to a token-gated Modal web endpoint; Modal cold-starts a
// real GPU container, runs a real PyTorch hyperparameter sweep on it, and
// returns the winning config plus the REAL GPU type and metered GPU-seconds.
//
// The cost is genuine: measured container GPU-seconds x Modal's published
// per-second GPU rate (cross-checkable on the Modal usage dashboard). It is
// booked as a NemoClaw-screened, capped Treasury spend. Nothing is simulated;
// if Modal is not configured this module reports unconfigured rather than faking.

// Modal's published per-second GPU prices (USD/sec). https://modal.com/pricing
export const GPU_RATE_USD_PER_SEC: Record<string, number> = {
  T4: 0.000164,
  L4: 0.000222,
  A10G: 0.000306,
  A10: 0.000306,
  L40S: 0.000542,
  A100: 0.000583,
  "A100-40GB": 0.000583,
  "A100-80GB": 0.000694,
  H100: 0.001097,
  H200: 0.001267,
  B200: 0.001736,
};

export function modalConfigured(): boolean {
  return !!process.env.HERMESCO_MODAL_ENDPOINT && !!process.env.HERMESCO_MODAL_SHARED_SECRET;
}

function rateForGpu(gpuType: string): number {
  return GPU_RATE_USD_PER_SEC[gpuType.toUpperCase()] ?? GPU_RATE_USD_PER_SEC.L4;
}

// Worst-case cost of a rental, used to screen the spend BEFORE any real money
// leaves the account (the rental timeout bounds the maximum billable seconds).
export function gpuMaxCostUsd(gpuType: string, maxRuntimeSec: number): number {
  const cost = rateForGpu(gpuType) * Math.max(1, maxRuntimeSec);
  return Math.max(0.01, Math.round(cost * 100) / 100);
}

export interface GpuRunResult {
  ok: boolean;
  output: string; // pretty-printed JSON deliverable for the job card
  deliverable: unknown; // structured result
  gpuType: string;
  cudaDevice: string;
  gpuSeconds: number; // real billed container GPU-seconds
  costUsd: number; // real metered Modal cost (>= $0.01 so it always books)
  durationMs: number; // wall time of the rental call
  error?: string;
}

interface ModalSweepResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
  gpu_type?: string;
  cuda_device?: string;
  billed_seconds?: number;
  cost_usd?: number;
  [k: string]: unknown;
}

// Rent a real Modal GPU and run the sweep. Throws only on transport failure;
// a job-level failure (e.g. no CUDA) comes back as { ok: false, error }.
export async function runGpuJob(
  brief: string,
  opts: { gpuType: string; maxRuntimeSec: number; seed?: number },
): Promise<GpuRunResult> {
  const endpoint = process.env.HERMESCO_MODAL_ENDPOINT;
  const secret = process.env.HERMESCO_MODAL_SHARED_SECRET;
  if (!endpoint || !secret) {
    throw new Error("Modal GPU substrate not configured (HERMESCO_MODAL_ENDPOINT / SHARED_SECRET).");
  }

  const started = Date.now();
  const controller = new AbortController();
  // Cold start + sweep, with generous headroom over the GPU-side timeout.
  const timeout = setTimeout(() => controller.abort(), (opts.maxRuntimeSec + 180) * 1000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ brief, gpu_type: opts.gpuType, seed: opts.seed ?? 7 }),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        output: text.slice(0, 2000),
        deliverable: null,
        gpuType: opts.gpuType,
        cudaDevice: "",
        gpuSeconds: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
        error: `Modal endpoint ${res.status}: ${text.slice(0, 300)}`,
      };
    }

    const data = JSON.parse(text) as ModalSweepResponse;
    const gpuType = String(data.gpu_type || opts.gpuType);
    const gpuSeconds = Number(data.billed_seconds || 0);

    if (!data.ok) {
      return {
        ok: false,
        output: JSON.stringify(data, null, 2),
        deliverable: data,
        gpuType,
        cudaDevice: String(data.cuda_device || ""),
        gpuSeconds,
        costUsd: 0,
        durationMs: Date.now() - started,
        error: String(data.error || data.detail || "GPU job returned ok=false."),
      };
    }

    // Real metered cost from Modal's response; floor at $0.01 so the spend
    // always books a visible ledger entry.
    const costUsd = Math.max(0.01, Math.round(Number(data.cost_usd || 0) * 100) / 100);

    return {
      ok: true,
      output: JSON.stringify(data, null, 2),
      deliverable: data,
      gpuType,
      cudaDevice: String(data.cuda_device || ""),
      gpuSeconds,
      costUsd,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}
