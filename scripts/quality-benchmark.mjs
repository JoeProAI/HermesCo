import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [k, v = "true"] = raw.slice(2).split("=");
    args[k] = v;
  }
  return args;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function countWordApprox(text) {
  const cleaned = (text || "").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

function containsAll(text, needles) {
  const lower = (text || "").toLowerCase();
  let hit = 0;
  for (const n of needles || []) {
    if (lower.includes(String(n).toLowerCase())) hit += 1;
  }
  return { hit, total: (needles || []).length };
}

function containsAny(text, needles) {
  const lower = (text || "").toLowerCase();
  return (needles || []).some((n) => lower.includes(String(n).toLowerCase()));
}

function qualityScore(response, testCase) {
  const text = String(response || "").trim();
  const words = countWordApprox(text);
  const includeStats = containsAll(text, testCase.mustInclude || []);
  const includeRatio = includeStats.total === 0 ? 1 : includeStats.hit / includeStats.total;
  const forbidden = containsAny(text, testCase.mustNotInclude || []);
  const minWords = Number(testCase.minWords || 0);
  const lengthScore = minWords <= 0 ? 1 : Math.min(1, words / minWords);
  const numberedSteps = /(^|\s)(1\.|1\))/m.test(text) ? 1 : 0;
  const formatScore = (testCase.mustInclude || []).some((x) => String(x).includes("1.")) ? numberedSteps : 1;
  const usefulnessScore = Math.min(1, (words >= 25 ? 0.5 : words / 50) + (includeRatio * 0.5));
  const correctnessScore = includeRatio * (forbidden ? 0 : 1);
  const overall = (correctnessScore * 0.5) + (usefulnessScore * 0.3) + (formatScore * 0.2);
  const pass = overall >= 0.7 && !forbidden && includeRatio >= 0.8;
  return {
    words,
    includeHit: includeStats.hit,
    includeTotal: includeStats.total,
    includeRatio,
    forbidden,
    correctnessScore,
    usefulnessScore,
    formatScore,
    overall,
    pass,
  };
}

async function runHttpCase({ baseUrl, authToken, prompt, modelTier, timeoutMs }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        message: prompt,
        modelTier,
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      return { ok: false, elapsedMs, error: `HTTP ${res.status}: ${raw.slice(0, 200)}`, text: "" };
    }
    const text = String(parsed?.response || parsed?.text || raw || "");
    return { ok: true, elapsedMs, error: null, text };
  } catch (error) {
    return { ok: false, elapsedMs: Date.now() - started, error: String(error), text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const datasetPath = path.resolve(process.cwd(), args.dataset || "benchmarks/quality/cases.sample.json");
  const outDir = path.resolve(process.cwd(), args.outDir || "benchmarks/quality/results");
  const mode = String(args.mode || "fixture").toLowerCase();
  const baseUrl = args.baseUrl || "http://127.0.0.1:3000";
  const authToken = args.authToken || process.env.BENCH_AUTH_TOKEN || "";
  const timeoutMs = Number(args.timeoutMs || 60000);
  const baselineTier = args.baselineTier || "standard";
  const candidateTier = args.candidateTier || "premium";

  const raw = readFileSync(datasetPath, "utf8");
  const dataset = JSON.parse(raw);
  const cases = Array.isArray(dataset.cases) ? dataset.cases : [];
  if (cases.length === 0) {
    throw new Error(`No benchmark cases in ${datasetPath}`);
  }

  const results = [];
  const reliabilityLatencies = [];
  let criticalErrors = 0;

  for (const testCase of cases) {
    let candidateText = String(testCase.candidate || "");
    let baselineText = String(testCase.baseline || "");
    let candidateMeta = { ok: true, elapsedMs: 0, error: null };
    let baselineMeta = { ok: true, elapsedMs: 0, error: null };

    if (mode === "http") {
      const candidateRun = await runHttpCase({
        baseUrl,
        authToken,
        prompt: testCase.prompt,
        modelTier: candidateTier,
        timeoutMs,
      });
      candidateText = candidateRun.text;
      candidateMeta = { ok: candidateRun.ok, elapsedMs: candidateRun.elapsedMs, error: candidateRun.error };

      const baselineRun = await runHttpCase({
        baseUrl,
        authToken,
        prompt: testCase.prompt,
        modelTier: baselineTier,
        timeoutMs,
      });
      baselineText = baselineRun.text;
      baselineMeta = { ok: baselineRun.ok, elapsedMs: baselineRun.elapsedMs, error: baselineRun.error };

      if (!candidateRun.ok || !baselineRun.ok) criticalErrors += 1;
      reliabilityLatencies.push(candidateRun.elapsedMs);
      reliabilityLatencies.push(baselineRun.elapsedMs);
    }

    const candidateScore = qualityScore(candidateText, testCase);
    const baselineScore = qualityScore(baselineText, testCase);
    const delta = candidateScore.overall - baselineScore.overall;
    const winner = delta > 0.02 ? "candidate" : delta < -0.02 ? "baseline" : "tie";

    results.push({
      id: testCase.id,
      prompt: testCase.prompt,
      candidate: {
        ...candidateScore,
        elapsedMs: candidateMeta.elapsedMs,
        ok: candidateMeta.ok,
        error: candidateMeta.error,
      },
      baseline: {
        ...baselineScore,
        elapsedMs: baselineMeta.elapsedMs,
        ok: baselineMeta.ok,
        error: baselineMeta.error,
      },
      winner,
      delta,
    });
  }

  const completionRate = (results.filter((r) => r.candidate.pass).length / results.length) * 100;
  const winRate = (results.filter((r) => r.winner === "candidate").length / results.length) * 100;
  const hallucinationRate = (results.filter((r) => r.candidate.forbidden).length / results.length) * 100;
  const criticalErrorRate = mode === "http" ? (criticalErrors / results.length) * 100 : 0;
  const p50LatencyMs = mode === "http" ? percentile(reliabilityLatencies, 50) : null;
  const p95LatencyMs = mode === "http" ? percentile(reliabilityLatencies, 95) : null;

  const thresholds = {
    completionRatePct: 95,
    winRatePct: 70,
    criticalErrorRatePct: 2,
    hallucinationRatePct: 5,
    p95LatencyMs: mode === "http" ? Number(args.p95TargetMs || 6000) : null,
  };

  const gates = {
    completionRate: completionRate >= thresholds.completionRatePct,
    winRate: winRate >= thresholds.winRatePct,
    criticalErrorRate: criticalErrorRate <= thresholds.criticalErrorRatePct,
    hallucinationRate: hallucinationRate <= thresholds.hallucinationRatePct,
    p95Latency: thresholds.p95LatencyMs == null || (p95LatencyMs != null && p95LatencyMs <= thresholds.p95LatencyMs),
  };

  const pass = Object.values(gates).every(Boolean);

  const summary = {
    benchmark: dataset.name || "quality benchmark",
    mode,
    datasetPath,
    generatedAt: new Date().toISOString(),
    totals: {
      cases: results.length,
      completionRate,
      winRate,
      hallucinationRate,
      criticalErrorRate,
      p50LatencyMs,
      p95LatencyMs,
    },
    thresholds,
    gates,
    pass,
  };

  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "scorecard.latest.json");
  const mdPath = path.join(outDir, "scorecard.latest.md");
  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2), "utf8");

  const lines = [];
  lines.push(`# Quality Scorecard`);
  lines.push("");
  lines.push(`- benchmark: ${summary.benchmark}`);
  lines.push(`- mode: ${mode}`);
  lines.push(`- generatedAt: ${summary.generatedAt}`);
  lines.push(`- pass: ${pass}`);
  lines.push("");
  lines.push(`## Metrics`);
  lines.push(`- completionRate: ${completionRate.toFixed(1)}%`);
  lines.push(`- winRate: ${winRate.toFixed(1)}%`);
  lines.push(`- hallucinationRate: ${hallucinationRate.toFixed(1)}%`);
  lines.push(`- criticalErrorRate: ${criticalErrorRate.toFixed(1)}%`);
  if (p50LatencyMs != null) lines.push(`- p50LatencyMs: ${p50LatencyMs}`);
  if (p95LatencyMs != null) lines.push(`- p95LatencyMs: ${p95LatencyMs}`);
  lines.push("");
  lines.push(`## Gates`);
  lines.push(`- completionRate>=${thresholds.completionRatePct}: ${gates.completionRate}`);
  lines.push(`- winRate>=${thresholds.winRatePct}: ${gates.winRate}`);
  lines.push(`- criticalErrorRate<=${thresholds.criticalErrorRatePct}: ${gates.criticalErrorRate}`);
  lines.push(`- hallucinationRate<=${thresholds.hallucinationRatePct}: ${gates.hallucinationRate}`);
  if (thresholds.p95LatencyMs != null) lines.push(`- p95Latency<=${thresholds.p95LatencyMs}: ${gates.p95Latency}`);
  lines.push("");
  lines.push(`## Cases`);
  for (const r of results) {
    lines.push(`- ${r.id}: winner=${r.winner}, candidate=${(r.candidate.overall * 100).toFixed(1)}, baseline=${(r.baseline.overall * 100).toFixed(1)}`);
  }
  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);

  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
