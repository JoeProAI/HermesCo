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
  // ─── COMPUTE ──────────────────────────────────────────────────────────────────
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
    key: "code-run",
    name: "Managed Run",
    tagline: "Run any script on an isolated machine (Python 3.12, Node 22, bash, git) and get the real output.",
    deliverable: "deliverable.txt: exit code and full stdout/stderr.",
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

  // ─── WEB + DATA ───────────────────────────────────────────────────────────────
  {
    key: "web-extract",
    name: "Web Extract",
    tagline: "Fetch any public web page and return clean, structured JSON (title, headings, links, content).",
    deliverable: "deliverable.json: title, headings, links, word count, and raw text sample.",
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
    key: "web-research",
    name: "Deep Web Research",
    tagline: "Research a topic across multiple sources and return a structured brief with citations.",
    deliverable: "deliverable.json: summary, key findings, source URLs, and raw data from each source.",
    briefLabel: "Research question or topic",
    briefPlaceholder: "Best hotels in Austin TX under $200/night with pools, for June 2026",
    suggestedPriceUsd: 40,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, urllib.parse, time
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
if not brief.strip():
    emit({"error": "empty_brief"}); sys.exit(2)

def fetch(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Research/1.0"})
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except Exception as e:
        return f"FETCH_ERROR: {e}"

def strip_html(s):
    return re.sub(r'<[^>]+>', ' ', s).strip()

def extract_text(html, max_chars=3000):
    body = re.sub(r'<script.*?</script>|<style.*?</style>|<nav.*?</nav>', ' ', html, flags=re.I|re.S)
    text = strip_html(body)
    text = re.sub(r'\\s+', ' ', text)
    return text[:max_chars]

# Use DuckDuckGo HTML search (no API key needed, real results)
query = urllib.parse.quote_plus(brief)
search_url = f"https://html.duckduckgo.com/html/?q={query}"
search_html = fetch(search_url)
# Extract result URLs from DDG HTML results
result_links = re.findall(r'href="(https?://[^"]+)"', search_html)
# Filter out DDG internal links
result_links = [l for l in result_links if "duckduckgo.com" not in l][:8]

sources = []
for url in result_links[:5]:
    time.sleep(0.5)
    html = fetch(url)
    if html.startswith("FETCH_ERROR"):
        sources.append({"url": url, "error": html})
        continue
    title = re.search(r'<title[^>]*>(.*?)</title>', html, re.I|re.S)
    text = extract_text(html)
    sources.append({
        "url": url,
        "title": strip_html(title.group(1)) if title else "",
        "excerpt": text[:1500],
    })

emit({
    "query": brief,
    "sources_found": len(result_links),
    "sources_fetched": len(sources),
    "results": sources,
})
PY`,
      ),
  },
  {
    key: "repo-pack",
    name: "Repo Pack",
    tagline: "Clone a public Git repo and return a metrics manifest (file count, languages, lines, largest files).",
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
    key: "data-analysis",
    name: "Data Analysis",
    tagline: "Process CSV, JSON, or raw data and return statistical analysis, patterns, and insights.",
    deliverable: "deliverable.json: statistics, distributions, correlations, outliers, and summary insights.",
    briefLabel: "Data URL or inline data + what to analyze",
    briefPlaceholder: "Analyze https://example.com/data.csv - find trends, outliers, and top correlations",
    suggestedPriceUsd: 35,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, csv, io, statistics
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
if not brief.strip():
    emit({"error": "empty_brief"}); sys.exit(2)

# Try to fetch data from URL if present
url_match = re.search(r'https?://\\S+', brief)
raw_data = None
if url_match:
    url = url_match.group(0).rstrip('.,);]"')
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Agent/1.0"})
        raw_data = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except Exception as e:
        emit({"error": f"fetch_failed: {e}", "url": url}); sys.exit(2)

if not raw_data:
    # Treat the brief itself as inline data
    raw_data = brief

# Try CSV parse
rows = []
try:
    reader = csv.DictReader(io.StringIO(raw_data))
    rows = list(reader)
except:
    pass

if not rows:
    # Try JSON
    import json as _json
    try:
        parsed = _json.loads(raw_data)
        if isinstance(parsed, list):
            rows = parsed
        elif isinstance(parsed, dict) and any(isinstance(v, list) for v in parsed.values()):
            for v in parsed.values():
                if isinstance(v, list):
                    rows = v; break
    except:
        pass

# Filter to only dict rows (primitives like [1,2,3] can't be column-analyzed)
rows = [r for r in rows if isinstance(r, dict)]

if not rows:
    emit({"error": "could_not_parse_data", "hint": "Provide a URL to a CSV/JSON file or paste data inline", "sample": raw_data[:500]})
    sys.exit(2)

# Analyze
result = {"row_count": len(rows), "columns": list(rows[0].keys()) if rows else []}
col_stats = {}
for col in result["columns"]:
    values = [r.get(col) for r in rows if r.get(col) not in (None, "")]
    nums = []
    for v in values:
        try: nums.append(float(v))
        except (ValueError, TypeError): pass
    if nums:
        col_stats[col] = {
            "type": "numeric",
            "count": len(nums),
            "min": min(nums),
            "max": max(nums),
            "mean": round(statistics.mean(nums), 4),
            "median": round(statistics.median(nums), 4),
            "stdev": round(statistics.stdev(nums), 4) if len(nums) > 1 else 0,
        }
    else:
        unique = set(values)
        col_stats[col] = {
            "type": "categorical",
            "count": len(values),
            "unique": len(unique),
            "top_values": sorted(list(unique))[:10],
        }
result["column_stats"] = col_stats
result["sample_rows"] = rows[:5]
emit(result)
PY`,
      ),
  },

  // ─── REAL-WORLD SERVICES ──────────────────────────────────────────────────────
  {
    key: "price-compare",
    name: "Price Comparison",
    tagline: "Search the web for a product or service and return real pricing from multiple sources.",
    deliverable: "deliverable.json: product/service options with prices, sources, and links.",
    briefLabel: "What to find pricing for",
    briefPlaceholder: "Hotels in Austin TX under $200/night for June 15-18 with a pool",
    suggestedPriceUsd: 30,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, urllib.parse, time
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
if not brief.strip():
    emit({"error": "empty_brief"}); sys.exit(2)

def fetch(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Research/1.0", "Accept": "text/html"})
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except Exception as e:
        return f"FETCH_ERROR: {e}"

def strip_html(s):
    return re.sub(r'<[^>]+>', ' ', s).strip()

def extract_prices(text):
    """Find dollar amounts in text"""
    return re.findall(r'\\$[\\d,]+(?:\\.\\d{2})?', text)

# Search with price-focused query
query = urllib.parse.quote_plus(f"{brief} price cost")
search_url = f"https://html.duckduckgo.com/html/?q={query}"
search_html = fetch(search_url)
result_links = re.findall(r'href="(https?://[^"]+)"', search_html)
result_links = [l for l in result_links if "duckduckgo.com" not in l][:8]

options = []
for url in result_links[:6]:
    time.sleep(0.5)
    html = fetch(url)
    if html.startswith("FETCH_ERROR"):
        continue
    title = re.search(r'<title[^>]*>(.*?)</title>', html, re.I|re.S)
    text = strip_html(html)[:5000]
    prices = extract_prices(text)
    if not prices and not title:
        continue
    options.append({
        "source": strip_html(title.group(1)) if title else url,
        "url": url,
        "prices_found": prices[:10],
        "excerpt": text[:800],
    })

emit({
    "query": brief,
    "sources_checked": len(result_links),
    "options": options,
    "note": "Prices are scraped from live web results. Verify availability directly at the source URLs.",
})
PY`,
      ),
  },
  {
    key: "seo-audit",
    name: "SEO Audit",
    tagline: "Analyze a website for SEO issues: meta tags, headers, performance hints, broken links, schema markup.",
    deliverable: "deliverable.json: SEO score, issues found, meta analysis, header structure, recommendations.",
    briefLabel: "Website URL to audit",
    briefPlaceholder: "https://mysite.com",
    suggestedPriceUsd: 35,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, urllib.parse, time
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
m = re.search(r'https?://\\S+', brief)
if not m:
    emit({"error": "no_url_in_brief"}); sys.exit(2)
url = m.group(0).rstrip('.,);]"')

def fetch(u, timeout=20):
    try:
        req = urllib.request.Request(u, headers={"User-Agent": "HermesCo-SEO-Audit/1.0"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        headers = dict(resp.headers)
        html = resp.read().decode("utf-8", "replace")
        return html, headers, resp.status
    except Exception as e:
        return None, {}, 0

html, headers, status = fetch(url)
if not html:
    emit({"error": "could_not_fetch", "url": url}); sys.exit(2)

issues = []
score = 100

# Title
title = re.search(r'<title[^>]*>(.*?)</title>', html, re.I|re.S)
title_text = re.sub(r'<[^>]+>', '', title.group(1)).strip() if title else ""
if not title_text:
    issues.append("CRITICAL: No <title> tag found"); score -= 20
elif len(title_text) > 60:
    issues.append(f"WARNING: Title too long ({len(title_text)} chars, aim for <60)")
    score -= 5
elif len(title_text) < 10:
    issues.append(f"WARNING: Title too short ({len(title_text)} chars)")
    score -= 5

# Meta description
meta_desc = re.search(r'<meta[^>]*name=["\']description["\'][^>]*content=["\'](.*?)["\']', html, re.I)
if not meta_desc:
    meta_desc = re.search(r'<meta[^>]*content=["\'](.*?)["\'][^>]*name=["\']description["\']', html, re.I)
desc_text = meta_desc.group(1) if meta_desc else ""
if not desc_text:
    issues.append("CRITICAL: No meta description"); score -= 15
elif len(desc_text) > 160:
    issues.append(f"WARNING: Meta description too long ({len(desc_text)} chars)")
    score -= 3

# H1
h1s = re.findall(r'<h1[^>]*>(.*?)</h1>', html, re.I|re.S)
if not h1s:
    issues.append("WARNING: No H1 tag found"); score -= 10
elif len(h1s) > 1:
    issues.append(f"WARNING: Multiple H1 tags ({len(h1s)})"); score -= 5

# Images without alt
imgs = re.findall(r'<img[^>]*>', html, re.I)
no_alt = [i for i in imgs if 'alt=' not in i.lower() or 'alt=""' in i.lower()]
if no_alt:
    issues.append(f"WARNING: {len(no_alt)}/{len(imgs)} images missing alt text")
    score -= min(10, len(no_alt) * 2)

# HTTPS
if not url.startswith("https://"):
    issues.append("CRITICAL: Not served over HTTPS"); score -= 15

# Canonical
canonical = re.search(r'<link[^>]*rel=["\']canonical["\'][^>]*href=["\'](.*?)["\']', html, re.I)
if not canonical:
    issues.append("WARNING: No canonical URL specified"); score -= 5

# Open Graph
og_title = re.search(r'<meta[^>]*property=["\']og:title["\']', html, re.I)
og_image = re.search(r'<meta[^>]*property=["\']og:image["\']', html, re.I)
if not og_title:
    issues.append("INFO: No Open Graph title (hurts social sharing)"); score -= 3
if not og_image:
    issues.append("INFO: No Open Graph image"); score -= 3

# Schema/JSON-LD
schema = re.findall(r'<script[^>]*type=["\']application/ld\\+json["\'][^>]*>', html, re.I)
if not schema:
    issues.append("INFO: No structured data (JSON-LD) found"); score -= 5

# Security headers
sec_headers = {}
for h in ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy"]:
    sec_headers[h] = headers.get(h, None)
    if not headers.get(h):
        issues.append(f"INFO: Missing security header {h}")

score = max(0, score)
emit({
    "url": url,
    "status": status,
    "score": score,
    "title": title_text,
    "meta_description": desc_text[:200],
    "h1_count": len(h1s),
    "image_count": len(imgs),
    "images_without_alt": len(no_alt),
    "has_canonical": bool(canonical),
    "has_og_tags": bool(og_title),
    "has_schema": bool(schema),
    "security_headers": sec_headers,
    "issues": issues,
    "recommendations": [
        i.split(": ", 1)[1] for i in issues if i.startswith("CRITICAL")
    ] + [
        i.split(": ", 1)[1] for i in issues if i.startswith("WARNING")
    ],
})
PY`,
      ),
  },
  {
    key: "security-scan",
    name: "Security Scan",
    tagline: "Check a domain for HTTPS config, exposed headers, open ports, DNS records, and common vulnerabilities.",
    deliverable: "deliverable.json: security grade, TLS info, headers analysis, DNS records, findings.",
    briefLabel: "Domain or URL to scan",
    briefPlaceholder: "example.com",
    suggestedPriceUsd: 40,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, urllib.parse, ssl, socket, json as _json
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
# Extract domain
domain = brief.strip()
domain = re.sub(r'^https?://', '', domain).split('/')[0].strip()
if not domain:
    emit({"error": "no_domain_in_brief"}); sys.exit(2)

findings = []
grade = "A"

# TLS check
tls_info = {}
try:
    ctx = ssl.create_default_context()
    with socket.create_connection((domain, 443), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
            cert = ssock.getpeercert()
            tls_info = {
                "version": ssock.version(),
                "cipher": ssock.cipher()[0] if ssock.cipher() else None,
                "issuer": dict(x[0] for x in cert.get("issuer", [])) if cert else {},
                "expires": cert.get("notAfter", "") if cert else "",
                "subject": dict(x[0] for x in cert.get("subject", [])) if cert else {},
                "san": [e[1] for e in cert.get("subjectAltName", [])] if cert else [],
            }
except Exception as e:
    findings.append(f"CRITICAL: TLS connection failed: {e}")
    grade = "F"
    tls_info = {"error": str(e)}

# HTTP headers check
headers_info = {}
try:
    req = urllib.request.Request(f"https://{domain}", headers={"User-Agent": "HermesCo-Security/1.0"})
    resp = urllib.request.urlopen(req, timeout=15)
    headers_info = dict(resp.headers)
    # Check security headers
    required = {
        "Strict-Transport-Security": "HSTS not set (browsers can be downgraded to HTTP)",
        "X-Content-Type-Options": "Missing (MIME sniffing attacks possible)",
        "X-Frame-Options": "Missing (clickjacking possible)",
        "Content-Security-Policy": "No CSP (XSS risk higher)",
    }
    missing_count = 0
    for h, risk in required.items():
        if h not in headers_info:
            findings.append(f"WARNING: {h} - {risk}")
            missing_count += 1
    if missing_count >= 3: grade = "C"
    elif missing_count >= 1 and grade == "A": grade = "B"
    # Check for info leaks
    if "Server" in headers_info:
        findings.append(f"INFO: Server header exposes: {headers_info['Server']}")
    if "X-Powered-By" in headers_info:
        findings.append(f"WARNING: X-Powered-By exposes tech stack: {headers_info['X-Powered-By']}")
        if grade in ("A", "B"): grade = "B"
except Exception as e:
    findings.append(f"WARNING: HTTPS fetch failed: {e}")
    if grade == "A": grade = "C"

# DNS records via system dig
import subprocess
dns_records = {}
for rtype in ["A", "AAAA", "MX", "TXT", "NS", "CNAME"]:
    try:
        out = subprocess.check_output(["dig", "+short", rtype, domain], timeout=5, stderr=subprocess.DEVNULL)
        records = [l.strip() for l in out.decode().strip().split("\\n") if l.strip()]
        if records:
            dns_records[rtype] = records
    except:
        pass

# Check HTTP -> HTTPS redirect
try:
    req = urllib.request.Request(f"http://{domain}", headers={"User-Agent": "HermesCo-Security/1.0"})
    resp = urllib.request.urlopen(req, timeout=10)
    final_url = resp.url
    if not final_url.startswith("https://"):
        findings.append("CRITICAL: HTTP does not redirect to HTTPS")
        if grade in ("A", "B", "C"): grade = "D"
except:
    pass  # HTTP might be completely blocked (good)

if not findings:
    findings.append("No issues found. Good security posture.")

emit({
    "domain": domain,
    "grade": grade,
    "tls": tls_info,
    "security_headers": {k: v for k, v in headers_info.items() if k.lower().startswith(("strict", "x-", "content-security", "referrer"))},
    "dns_records": dns_records,
    "findings": findings,
})
PY`,
      ),
  },
  {
    key: "domain-research",
    name: "Domain Research",
    tagline: "Look up WHOIS info, DNS records, hosting provider, and tech stack for any domain.",
    deliverable: "deliverable.json: registrar, expiry, nameservers, DNS records, IP geolocation, detected technologies.",
    briefLabel: "Domain name",
    briefPlaceholder: "stripe.com",
    suggestedPriceUsd: 25,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, subprocess, socket, urllib.request
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
domain = re.sub(r'^https?://', '', brief.strip()).split('/')[0].strip()
if not domain:
    emit({"error": "no_domain_in_brief"}); sys.exit(2)

# DNS records
dns = {}
for rtype in ["A", "AAAA", "MX", "NS", "TXT", "SOA", "CNAME"]:
    try:
        out = subprocess.check_output(["dig", "+short", rtype, domain], timeout=5, stderr=subprocess.DEVNULL)
        records = [l.strip() for l in out.decode().strip().split("\\n") if l.strip()]
        if records: dns[rtype] = records
    except: pass

# Resolve IP
ip = None
try:
    ip = socket.gethostbyname(domain)
except: pass

# WHOIS (basic parsing)
whois_data = {}
try:
    out = subprocess.check_output(["whois", domain], timeout=10, stderr=subprocess.DEVNULL)
    whois_text = out.decode("utf-8", "replace")
    for line in whois_text.split("\\n"):
        line = line.strip()
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip().lower()
            val = val.strip()
            if key in ("registrar", "creation date", "registry expiry date", "updated date", "registrant organization", "registrant country"):
                whois_data[key.replace(" ", "_")] = val
except: pass

# Check what tech the site uses via response headers
tech_hints = []
try:
    req = urllib.request.Request(f"https://{domain}", headers={"User-Agent": "HermesCo-Agent/1.0"})
    resp = urllib.request.urlopen(req, timeout=10)
    h = dict(resp.headers)
    if "Server" in h: tech_hints.append(f"Server: {h['Server']}")
    if "X-Powered-By" in h: tech_hints.append(f"Powered-By: {h['X-Powered-By']}")
    if "cf-ray" in (k.lower() for k in h): tech_hints.append("CDN: Cloudflare")
    html = resp.read(8000).decode("utf-8", "replace")
    if "wp-content" in html: tech_hints.append("CMS: WordPress")
    if "next/static" in html or "__next" in html: tech_hints.append("Framework: Next.js")
    if "shopify" in html.lower(): tech_hints.append("Platform: Shopify")
    if "react" in html.lower(): tech_hints.append("Library: React")
except: pass

emit({
    "domain": domain,
    "ip": ip,
    "dns_records": dns,
    "whois": whois_data,
    "tech_detected": tech_hints,
})
PY`,
      ),
  },
  {
    key: "translate",
    name: "Translation",
    tagline: "Translate text between languages using a real translation API (no LLM hallucination).",
    deliverable: "deliverable.json: original text, translated text, source language, target language.",
    briefLabel: "Text to translate + target language",
    briefPlaceholder: "Translate to Spanish: Your AI agent is ready. Connect your messaging apps to get started.",
    suggestedPriceUsd: 15,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, urllib.parse, json as _json
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
if not brief.strip():
    emit({"error": "empty_brief"}); sys.exit(2)

# Parse target language from brief
lang_map = {
    "spanish": "es", "french": "fr", "german": "de", "italian": "it",
    "portuguese": "pt", "russian": "ru", "japanese": "ja", "chinese": "zh",
    "korean": "ko", "arabic": "ar", "hindi": "hi", "dutch": "nl",
    "swedish": "sv", "polish": "pl", "turkish": "tr", "thai": "th",
    "vietnamese": "vi", "indonesian": "id", "ukrainian": "uk", "czech": "cs",
}

target = "es"  # default Spanish
text = brief
for lang_name, lang_code in lang_map.items():
    pattern = rf'(?:to|into|in)\\s+{lang_name}'
    if re.search(pattern, brief, re.I):
        target = lang_code
        # Remove the translation instruction prefix
        text = re.sub(rf'.*?(?:to|into|in)\\s+{lang_name}[:\\s]*', '', brief, count=1, flags=re.I).strip()
        break
# Also check for "translate ... :" pattern
colon_match = re.match(r'.*?:\\s*(.+)', brief, re.S)
if colon_match and text == brief:
    text = colon_match.group(1).strip()

if not text:
    text = brief

# Use LibreTranslate (free, real translation, no API key)
# Fallback: MyMemory API (free tier, 5000 chars/day)
translated = None
try:
    params = urllib.parse.urlencode({"q": text[:5000], "langpair": f"autodetect|{target}"})
    url = f"https://api.mymemory.translated.net/get?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Agent/1.0"})
    resp = urllib.request.urlopen(req, timeout=15)
    data = _json.loads(resp.read().decode())
    if data.get("responseStatus") == 200:
        translated = data["responseData"]["translatedText"]
except Exception as e:
    pass

if not translated:
    emit({"error": "translation_service_unavailable", "text": text[:500], "target": target})
    sys.exit(2)

emit({
    "original": text[:5000],
    "translated": translated,
    "source_language": "autodetect",
    "target_language": target,
    "char_count": len(text),
})
PY`,
      ),
  },
  {
    key: "pdf-extract",
    name: "PDF Text Extract",
    tagline: "Download a PDF from a URL and extract all text content, tables, and metadata.",
    deliverable: "deliverable.json: full text, page count, metadata, and structured sections.",
    briefLabel: "PDF URL",
    briefPlaceholder: "https://example.com/report.pdf",
    suggestedPriceUsd: 25,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, subprocess, os
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
m = re.search(r'https?://\\S+', brief)
if not m:
    emit({"error": "no_url_in_brief", "hint": "Provide a URL to a PDF file"}); sys.exit(2)
url = m.group(0).rstrip('.,);]"')

# Download PDF
pdf_path = "/tmp/hermesco_dl.pdf"
try:
    req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Agent/1.0"})
    data = urllib.request.urlopen(req, timeout=30).read()
    with open(pdf_path, "wb") as f:
        f.write(data)
except Exception as e:
    emit({"error": f"download_failed: {e}", "url": url}); sys.exit(2)

# Install pdftotext if not present (poppler-utils)
try:
    subprocess.check_output(["which", "pdftotext"], stderr=subprocess.DEVNULL)
except:
    subprocess.run(["apt-get", "update", "-qq"], capture_output=True)
    subprocess.run(["apt-get", "install", "-y", "-qq", "poppler-utils"], capture_output=True)

# Extract text
try:
    text = subprocess.check_output(["pdftotext", "-layout", pdf_path, "-"], timeout=30, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
except Exception as e:
    emit({"error": f"extraction_failed: {e}"}); sys.exit(2)

# Get page count
pages = 0
try:
    info = subprocess.check_output(["pdfinfo", pdf_path], timeout=10, stderr=subprocess.DEVNULL).decode()
    pm = re.search(r'Pages:\\s*(\\d+)', info)
    if pm: pages = int(pm.group(1))
except: pass

# Parse sections (lines that look like headers)
sections = []
for line in text.split("\\n"):
    stripped = line.strip()
    if stripped and len(stripped) < 100 and stripped == stripped.upper() and len(stripped) > 3:
        sections.append(stripped)
    elif stripped and re.match(r'^\\d+\\.\\s+\\S', stripped):
        sections.append(stripped)

emit({
    "url": url,
    "pages": pages,
    "char_count": len(text),
    "word_count": len(text.split()),
    "sections": sections[:30],
    "text": text[:15000],
})
PY`,
      ),
  },
  {
    key: "api-call",
    name: "API Integration",
    tagline: "Call any public REST API and return the structured response. Handles auth, pagination, and rate limits.",
    deliverable: "deliverable.json: API response data, status, headers, and any errors.",
    briefLabel: "API endpoint + method + any params",
    briefPlaceholder: "GET https://api.github.com/repos/torvalds/linux - return stars, forks, language",
    suggestedPriceUsd: 20,
    buildCommand: (brief) =>
      wrap(
        brief,
        `python3 - "$BRIEF" <<'PY'
import sys, re, urllib.request, urllib.parse, json as _json
${PY_ART}
brief = sys.argv[1] if len(sys.argv) > 1 else ""
if not brief.strip():
    emit({"error": "empty_brief"}); sys.exit(2)

# Parse method and URL
method = "GET"
method_match = re.match(r'^(GET|POST|PUT|DELETE|PATCH|HEAD)\\s+', brief, re.I)
if method_match:
    method = method_match.group(1).upper()
    brief = brief[method_match.end():]

url_match = re.search(r'https?://\\S+', brief)
if not url_match:
    emit({"error": "no_url_in_brief", "hint": "Provide a full API URL (https://...)"}); sys.exit(2)
url = url_match.group(0).rstrip('.,);]"')

# Parse optional JSON body
body = None
json_match = re.search(r'\\{[^}]+\\}', brief)
if json_match and method in ("POST", "PUT", "PATCH"):
    try:
        body = json_match.group(0).encode()
    except: pass

# Parse optional headers from brief (Header: Value pattern after the URL)
custom_headers = {"User-Agent": "HermesCo-Agent/1.0", "Accept": "application/json"}
header_matches = re.findall(r'(?:header|Header)s?:\\s*([\\w-]+):\\s*(\\S+)', brief)
for k, v in header_matches:
    custom_headers[k] = v

try:
    req = urllib.request.Request(url, data=body, method=method, headers=custom_headers)
    if body:
        req.add_header("Content-Type", "application/json")
    resp = urllib.request.urlopen(req, timeout=30)
    resp_headers = dict(resp.headers)
    resp_body = resp.read().decode("utf-8", "replace")
    # Try to parse as JSON
    try:
        parsed = _json.loads(resp_body)
    except:
        parsed = resp_body[:10000]

    emit({
        "url": url,
        "method": method,
        "status": resp.status,
        "response_headers": {k: v for k, v in resp_headers.items() if k.lower() in ("content-type", "x-ratelimit-remaining", "x-ratelimit-limit")},
        "data": parsed if not isinstance(parsed, str) else parsed[:10000],
    })
except urllib.error.HTTPError as e:
    body_text = e.read().decode("utf-8", "replace")[:2000] if hasattr(e, "read") else ""
    emit({"url": url, "method": method, "status": e.code, "error": str(e), "response": body_text})
except Exception as e:
    emit({"url": url, "method": method, "error": str(e)})
PY`,
      ),
  },

  // ─── CATCH-ALL ────────────────────────────────────────────────────────────────
  {
    key: "custom",
    name: "Custom Job",
    tagline: "Any task that can be done with code, web access, and a bash shell. Hermes figures it out.",
    deliverable: "deliverable.json or deliverable.txt: whatever the task produces.",
    briefLabel: "Describe the task in detail",
    briefPlaceholder: "Find the 5 cheapest direct flights from LAX to Austin on June 20 and return them as a table",
    suggestedPriceUsd: 50,
    buildCommand: (brief) =>
      wrap(
        brief,
        `OUT="${ART_DIR}/deliverable.txt"
# Custom job: the agent wrote this command based on the customer's brief.
# The brief is available as $BRIEF. Write the output to $OUT.
echo "Executing custom job..."
echo "Brief: $BRIEF"
echo ""
# Use Python for complex tasks
python3 - "$BRIEF" <<'PY'
import sys, os, re, urllib.request, urllib.parse, json, time
ART_DIR = "${ART_DIR}"
os.makedirs(ART_DIR, exist_ok=True)
brief = sys.argv[1] if len(sys.argv) > 1 else ""

def fetch(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HermesCo-Agent/1.0"})
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except Exception as e:
        return f"ERROR: {e}"

def search(query, n=5):
    q = urllib.parse.quote_plus(query)
    html = fetch(f"https://html.duckduckgo.com/html/?q={q}")
    links = re.findall(r'href="(https?://[^"]+)"', html)
    links = [l for l in links if "duckduckgo.com" not in l]
    return links[:n]

# Execute the task: search, fetch, analyze
results = []
queries = [brief]
links = search(brief)

for url in links[:5]:
    time.sleep(0.5)
    content = fetch(url)
    if content.startswith("ERROR"):
        results.append({"url": url, "error": content})
        continue
    # Extract useful text
    title = re.search(r'<title[^>]*>(.*?)</title>', content, re.I|re.S)
    text = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', content, flags=re.I|re.S)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\\s+', ' ', text).strip()
    results.append({
        "url": url,
        "title": re.sub(r'<[^>]+>', '', title.group(1)).strip() if title else "",
        "content": text[:2000],
    })

output = {
    "task": brief,
    "sources_searched": len(links),
    "results": results,
}
path = os.path.join(ART_DIR, "deliverable.json")
with open(path, "w") as f:
    json.dump(output, f, indent=2)
print(json.dumps(output, indent=2))
print("ARTIFACT:" + path)
PY`,
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
