/**
 * Cloudflare Worker — Wake Splash for agent-*.clawd.run
 *
 * Sits on the route pattern `agent-*.clawd.run/*`. Passes requests through
 * to the tunnel origin. When the origin returns 502/503 (sandbox sleeping),
 * serves an inline wake page that calls /api/wake and polls until ready.
 *
 * Deploy: `cd workers/wake-splash && npx wrangler deploy`
 */

const WAKE_API = "https://clawd.run/api/wake";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname; // e.g. agent-kuacgcmv.clawd.run

    // Only intercept agent-*.clawd.run — pass everything else through
    const match = hostname.match(/^(agent-[a-z0-9]+)\.clawd\.run$/);
    if (!match) {
      return fetch(request);
    }

    const subdomain = match[1];

    // Don't intercept API/health endpoints — let those return real status codes
    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      return fetch(request);
    }

    // Pass through to origin (the CF tunnel)
    try {
      const response = await fetch(request);

      // If the tunnel is healthy, pass through
      // Tunnel errors: 502, 503, 504 (standard), 520-530 (CF tunnel/origin errors including 1033)
      const s = response.status;
      if (s < 500 || (s > 504 && s < 520) || s > 530) {
        return response;
      }

      // Tunnel is down — serve wake splash
      return new Response(wakePage(subdomain, url.hash), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      // fetch() itself failed (tunnel unreachable) — serve wake splash
      return new Response(wakePage(subdomain, url.hash), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  },
};

function wakePage(subdomain, hash) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>clawd.run — Waking Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap');
    body {
      background: #07070e;
      color: #fff;
      font-family: 'Space Grotesk', system-ui, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
    }
    .logo {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .logo .dot { color: #6366f1; }
    .status {
      font-size: 14px;
      color: #9ca3af;
      transition: color 0.3s;
    }
    .status.error { color: #ef4444; }
    .status.ready { color: #22c55e; }
    .spinner {
      width: 32px;
      height: 32px;
      border: 2px solid #1e1e2e;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .spinner.done { display: none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sub {
      font-size: 12px;
      color: #4b5563;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="logo">clawd<span class="dot">.</span>run</div>
  <div class="status" id="status">Your agent is sleeping. Waking it up (may take up to 3 minutes)...</div>
  <div class="spinner" id="spinner"></div>
  <div class="sub">${subdomain}.clawd.run</div>

  <script>
    const SUB = "${subdomain}";
    const HASH = ${JSON.stringify(hash || "")};
    const WAKE_URL = "${WAKE_API}?sub=" + SUB;
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // ~3min at 3s intervals

    let probeAttempts = 0;
    let agentToken = null;

    async function probeAndRedirect(el, sp) {
      try {
        // Fetch the actual page — if we get a non-5xx response, it's alive
        const res = await fetch(location.origin + "/health", { cache: "no-store" });
        if (res.ok || (res.status >= 200 && res.status < 500)) {
          el.textContent = "Agent is ready. Redirecting...";
          el.className = "status ready";
          sp.className = "spinner done";
          // Redirect with token if available
          setTimeout(() => {
            const url = new URL(location.href);
            url.searchParams.delete('_wake');
            // Inject token into hash if not already present
            if (agentToken && !url.hash.includes('token=')) {
              url.hash = '#token=' + agentToken;
            }
            location.replace(url.toString());
          }, 1000);
          return;
        }
      } catch (e) { /* tunnel still down */ }

      probeAttempts++;
      if (probeAttempts > 60) {
        el.textContent = "Tunnel is taking a while. Try refreshing in a minute.";
        el.className = "status error";
        sp.className = "spinner done";
        return;
      }

      const msgs = [
        "Starting sandbox...",
        "Tunnel connecting (this can take up to 3 minutes)...",
        "Almost there...",
        "Still waiting for tunnel...",
      ];
      el.textContent = msgs[Math.min(Math.floor(probeAttempts / 5), msgs.length - 1)];
      setTimeout(() => probeAndRedirect(el, sp), 3000);
    }

    async function wake() {
      const el = document.getElementById("status");
      const sp = document.getElementById("spinner");
      try {
        const res = await fetch(WAKE_URL);
        const data = await res.json();

        if (data.token) agentToken = data.token;

        if (data.status === "running" || data.status === "starting") {
          // Don't trust the API status alone — probe the actual tunnel
          el.textContent = "Agent started. Waiting for tunnel...";
          probeAndRedirect(el, sp);
          return;
        }

        if (data.error && !data.status) {
          el.textContent = data.error;
          el.className = "status error";
          sp.className = "spinner done";
          return;
        }

        // Unknown status — retry wake call
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          el.textContent = "Taking longer than expected. Try refreshing in a minute.";
          el.className = "status error";
          sp.className = "spinner done";
          return;
        }
        el.textContent = "Waking up your agent...";
        setTimeout(wake, 3000);

      } catch (e) {
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          el.textContent = "Could not reach wake service. Try again later.";
          el.className = "status error";
          sp.className = "spinner done";
          return;
        }
        setTimeout(wake, 3000);
      }
    }

    // Start immediately
    wake();
  </script>
</body>
</html>`;
}
