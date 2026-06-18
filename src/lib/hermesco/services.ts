// HermesCo - the service catalog. These are the REAL jobs HermesCo sells. Each
// one runs as a concrete bash command on the agent's own Fly machine (Python
// 3.12, Node 22, git, bash) and produces a real, usable deliverable. Nothing is
// templated or faked: the customer's brief is executed and the actual output is
// returned.
//
// The customer's brief is passed into the command base64-encoded (shell-safe:
// only [A-Za-z0-9+/=]) and decoded inside the shell, so a brief can contain any
// characters without breaking the command or allowing injection into the wrapper.

export interface ServiceSpec {
  key: string;
  name: string;
  tagline: string; // one line a customer (or another agent) reads to decide
  deliverable: string; // what they get back
  briefLabel: string; // what the brief field should contain
  briefPlaceholder: string;
  suggestedPriceUsd: number;
  // Where the real work runs. "fly" (default) runs a bash command on the
  // agent's own Fly machine; "modal-gpu" rents a REAL external GPU from Modal.
  substrate?: "fly" | "modal-gpu";
  // For modal-gpu services: which GPU to rent and the hard runtime ceiling that
  // bounds the maximum billable cost (used to screen the spend before renting).
  gpu?: { type: string; maxRuntimeSec: number };
  // Build the real bash command from the customer's brief (fly substrate only).
  buildCommand?: (brief: string) => string;
}

const ART_DIR = "/root/hermesco_jobs";

// Wrap a job script so the brief is available as $BRIEF and the shell fails fast.
function wrap(brief: string, script: string): string {
  const b64 = Buffer.from(brief, "utf8").toString("base64");
  return [
    "set -uo pipefail",
    `mkdir -p ${ART_DIR}`,
    `BRIEF="$(printf %s '${b64}' | base64 -d)"`,
    "export BRIEF",
    script,
  ].join("\n");
}

// A small Python preamble shared by jobs that emit a JSON artifact.
const PY_ART = `import json, os
ART_DIR = "${ART_DIR}"
os.makedirs(ART_DIR, exist_ok=True)
def emit(obj):
    path = os.path.join(ART_DIR, "deliverable.json")
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
    print(json.dumps(obj, indent=2))
    print("ARTIFACT:" + path)`;

export const SERVICES: ServiceSpec[] = [
  {
    key: "gpu-sweep",
    name: "GPU Hyperparameter Sweep",
    tagline:
      "Rent a real cloud GPU on demand and run a hyperparameter sweep (parameter golf); get the winning config back.",
    deliverable:
      "deliverable.json: the best hyperparameters, full leaderboard, the real GPU used, and the real GPU-seconds billed.",
    briefLabel: "Sweep objective",
    briefPlaceholder: "Tune a small classifier on a hard 2-class spiral dataset",
    suggestedPriceUsd: 30,
    substrate: "modal-gpu",
    gpu: { type: "L4", maxRuntimeSec: 240 },
  },
  {
    key: "web-extract",
    name: "Web Extract",
    tagline: "Fetch a public web page and return clean, structured JSON an agent can consume.",
    deliverable: "deliverable.json: title, headings, links, and word count for the page.",
    briefLabel: "Page URL",
    briefPlaceholder: "https://news.ycombinator.com",
    suggestedPriceUsd: 25,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
m = re.search(r'https?://\\S+', brief)
if not m:
    emit({"error": "no_url_in_brief", "brief": brief}); sys.exit(2)
url = m.group(0).rstrip('.,);]"')
req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Agent/1.0"})
html = urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "replace")
strip = lambda s: re.sub(r'<[^>]+>', '', s).strip()
title = re.search(r'<title[^>]*>(.*?)</title>', html, re.I | re.S)
heads = re.findall(r'<h[1-3][^>]*>(.*?)</h[1-3]>', html, re.I | re.S)
links = re.findall(r'href="(https?://[^"]+)"', html)
body = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.I | re.S)
words = len(strip(body).split())
emit({
    "url": url,
    "title": strip(title.group(1)) if title else "",
    "headings": [strip(h) for h in heads][:25],
    "link_count": len(set(links)),
    "sample_links": sorted(set(links))[:15],
    "word_count": words,
})
PY`,
      ),
  },
  {
    key: "repo-pack",
    name: "Repo Pack",
    tagline: "Clone a public Git repo and return a metrics manifest agents use to size up a codebase.",
    deliverable: "deliverable.json: file count, languages by extension, total lines, largest files.",
    briefLabel: "Git repository URL",
    briefPlaceholder: "https://github.com/sindresorhus/is",
    suggestedPriceUsd: 35,
    buildCommand: (brief) =>
      wrap(
        brief,
        `URL="$(printf %s "$BRIEF" | grep -oE 'https?://[^[:space:]]+' | head -n1)"
if [ -z "$URL" ]; then echo '{"error":"no_git_url_in_brief"}'; exit 2; fi
DEST="$(mktemp -d)"
git clone --depth 1 "$URL" "$DEST/repo" >/dev/null 2>&1 || { echo '{"error":"clone_failed"}'; exit 2; }
REPO="$DEST/repo" python3 - <<'PY'
import os, collections
${PY_ART}
repo = os.environ["REPO"]
exts = collections.Counter(); total_lines = 0; files = []
for root, dirs, names in os.walk(repo):
    if ".git" in dirs: dirs.remove(".git")
    for n in names:
        p = os.path.join(root, n)
        try: size = os.path.getsize(p)
        except OSError: continue
        ext = (os.path.splitext(n)[1] or "(none)").lower()
        exts[ext] += 1
        try:
            with open(p, "rb") as f: lines = f.read().count(b"\\n")
        except OSError: lines = 0
        total_lines += lines
        files.append((os.path.relpath(p, repo), size, lines))
files.sort(key=lambda x: x[1], reverse=True)
emit({
    "files": len(files),
    "total_lines": total_lines,
    "languages": dict(exts.most_common(15)),
    "largest_files": [{"path": p, "bytes": s, "lines": l} for p, s, l in files[:10]],
})
PY`,
      ),
  },
  {
    key: "code-run",
    name: "Managed Run",
    tagline: "Offload a script to a powerful, isolated machine and get the real output back.",
    deliverable: "deliverable.txt: the exit code and full stdout/stderr of your task.",
    briefLabel: "Shell / Python task to run",
    briefPlaceholder: "python3 -c \"print(sum(i*i for i in range(10000)))\"",
    suggestedPriceUsd: 20,
    buildCommand: (brief) =>
      wrap(
        brief,
        `OUT="${ART_DIR}/deliverable.txt"
{ bash -c "$BRIEF"; } > "$OUT" 2>&1
RC=$?
echo "exit_code=$RC"
echo "----- output -----"
cat "$OUT"
echo "ARTIFACT:$OUT"
exit $RC`,
      ),
  },
];

export function getService(key: string): ServiceSpec | null {
  return SERVICES.find((s) => s.key === key) ?? null;
}

export function serviceRunsOn(s: ServiceSpec): string {
  return s.substrate === "modal-gpu"
    ? `Modal ${s.gpu?.type ?? "GPU"} (a real rented cloud GPU)`
    : "the agent's own Fly machine";
}

// A compact catalog the agent can read to decide what it can sell.
export function serviceCatalog(): Array<{
  key: string;
  name: string;
  tagline: string;
  deliverable: string;
  brief: string;
  suggested_price_usd: number;
  runs_on: string;
}> {
  return SERVICES.map((s) => ({
    key: s.key,
    name: s.name,
    tagline: s.tagline,
    deliverable: s.deliverable,
    brief: s.briefLabel,
    suggested_price_usd: s.suggestedPriceUsd,
    runs_on: serviceRunsOn(s),
  }));
}
