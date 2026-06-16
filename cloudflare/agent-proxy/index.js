// clawd.run agent proxy: <flyapp>.clawd.run -> <flyapp>.fly.dev (backend hidden).
//
// Cold-start handling without anything that can hang or sit:
//  - The top-level page load is proxied with a 5s timeout. If the dashboard
//    comes back, serve it (gateway is up, so the WebSocket will connect).
//  - If it times out or 5xx's (machine still waking), serve a splash that
//    reloads itself on a plain timer (no fetch -> can't hang), capped so it
//    can't loop forever.
//  - WebSocket and asset requests always pass straight through.
// Fail-safe: any unexpected error falls through to a plain proxy.

const SPLASH = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waking your agent…</title>
<style>
html,body{margin:0;height:100%;background:#0E0E10;color:#C8893E;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
display:flex;align-items:center;justify-content:center}
.wrap{text-align:center}
.dot{width:9px;height:9px;border-radius:50%;background:#C8893E;display:inline-block;
animation:pulse 1s infinite alternate}
@keyframes pulse{to{opacity:.25}}
p{margin-top:14px;letter-spacing:.04em;font-size:13px}
.sub{margin-top:10px;max-width:340px;font-size:11px;line-height:1.6;color:#7a6a52}
</style></head><body><div class="wrap"><span class="dot"></span>
<p id="m">Waking your agent…</p>
<p class="sub">Your agent runs on its own dedicated machine — not a shared VPS.
It sleeps when idle so you never pay for dead time, and boots fresh when you
return. First wake can take a couple of minutes.</p>
<p class="sub" id="s" style="display:none">Heads up: the very first launch (or the
first wake after an upgrade) downloads and sets up your agent — this one-time
boot can take up to 10 minutes. Hang tight; this page refreshes itself.</p></div>
<script>
var k='clawd_wake_t',now=Date.now(),t0=parseInt(sessionStorage.getItem(k))||0;
// Treat a stale marker as a new wake (covers a later sleep in the same tab).
if(!t0||now-t0>15*60*1000){t0=now;sessionStorage.setItem(k,String(t0));}
var el=now-t0;
if(el>=2.5*60*1000){document.getElementById('s').style.display='block';}
if(el>=12*60*1000){document.getElementById('m').textContent='Still starting — refresh to retry.';}
else{setTimeout(function(){location.reload();},2500);}
</script></body></html>`;

async function fetchTimeout(req, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(req, { signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname;

    // Only agent hosts proxy; everything else goes to the marketing site.
    if (!(host.startsWith("lp-") && host.endsWith(".clawd.run"))) {
      return Response.redirect("https://clawd.run", 302);
    }

    url.hostname = host.replace(/\.clawd\.run$/, ".fly.dev");

    const isWs =
      (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
    const accept = request.headers.get("Accept") || "";
    const isDocNav =
      request.method === "GET" && !isWs && accept.includes("text/html");
    const proxied = new Request(url, request);

    if (isDocNav) {
      try {
        const r = await fetchTimeout(proxied, 5000);
        // Got a real response from the gateway -> serve it (warm). Only a
        // timeout or 5xx (still waking) drops to the splash.
        if (r.status < 500) return r;
      } catch {
        /* timed out / unreachable -> splash */
      }
      return new Response(SPLASH, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return fetch(proxied);
  },
};
