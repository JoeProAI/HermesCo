export const CLAWD_RUNTIME_WRAPPER_SOURCE = String.raw`
const http = require("http");
const net = require("net");

const HERMES_HOST = "127.0.0.1";
const HERMES_PORT = 9119;
const OPENCLAW_HOST = "127.0.0.1";
const OPENCLAW_PORT = 8400;
const LISTEN_HOST = "0.0.0.0";
const LISTEN_PORT = 8401;

const BAR = '<div id="clawd-bar" style="position:fixed;top:0;left:0;right:0;height:40px;background:#07070e;border-bottom:1px solid #0f0f1e;display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:999999;font-family:system-ui,sans-serif;box-sizing:border-box"><div style="display:flex;align-items:center;gap:10px"><a style="color:#fff;font-weight:700;font-size:13px;letter-spacing:-.03em;text-decoration:none" href="https://clawd.run" target="_blank">clawd<span style="color:#6366f1">.</span>run</a><span style="color:#1e1e3a;font-size:11px">/</span><span id="cld-name" style="color:#9ca3af;font-size:12px;font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">agent</span></div><div style="display:flex;align-items:center;gap:8px"><a id="cld-chain" href="https://arweave.net" target="_blank" style="display:none;align-items:center;gap:4px;font-size:11px;color:#4b5563;text-decoration:none;border:1px solid #1a1a2e;padding:3px 8px;border-radius:3px"><span style="width:5px;height:5px;border-radius:50%;background:#6366f1;display:inline-block"></span>soul chain</a><a id="cld-mint" href="https://clawd.run/mint" target="_blank" style="display:none;align-items:center;gap:4px;font-size:11px;color:#4b5563;text-decoration:none;border:1px solid #1a1a2e;padding:3px 8px;border-radius:3px"><span style="width:5px;height:5px;border-radius:50%;background:#374151;display:inline-block"></span>mint soul</a><a href="https://clawd.run/dashboard" target="_blank" style="font-size:11px;color:#4b5563;text-decoration:none;border:1px solid #1a1a2e;padding:3px 8px;border-radius:3px;font-family:inherit">settings</a></div></div><div style="height:40px;flex-shrink:0"></div><style>body{padding-top:40px!important}</style>';
const HASH_SCRIPT = '<script>try{const p=new URLSearchParams(location.hash.slice(1));const n=p.get("name");const tx=p.get("tx");if(n){const el=document.getElementById("cld-name");if(el)el.textContent=n;}if(tx){const el=document.getElementById("cld-chain");if(el){el.href="https://arweave.net/"+tx;el.style.display="flex";}}else{const el=document.getElementById("cld-mint");if(el)el.style.display="flex";}const tok=p.get("token");if(tok)localStorage.setItem("clawd.gateway.token.v1",tok);}catch(e){}</script>';

function injectChrome(html) {
  let out = html;
  const headIdx = out.indexOf("<head");
  if (headIdx !== -1) {
    const insertIdx = out.indexOf(">", headIdx) + 1;
    out = out.slice(0, insertIdx) + HASH_SCRIPT + out.slice(insertIdx);
  } else {
    out = HASH_SCRIPT + out;
  }

  const bodyIdx = out.indexOf("<body");
  if (bodyIdx !== -1) {
    const insertIdx = out.indexOf(">", bodyIdx) + 1;
    out = out.slice(0, insertIdx) + BAR + out.slice(insertIdx);
  } else {
    out = BAR + out;
  }

  return out;
}

function isOpenClawSpecificPath(pathname) {
  return (
    pathname === "/health" ||
    pathname === "/api/message" ||
    pathname.startsWith("/v1/")
  );
}

function healthz(res) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, upstreams: { hermes: HERMES_PORT, openclaw: OPENCLAW_PORT } }));
}

function proxyHttp(req, res, target, fallbackTarget) {
  const headers = { ...req.headers, host: target.host + ":" + target.port };
  delete headers["content-length"];

  const proxyReq = http.request(
    {
      hostname: target.host,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const contentType = String(proxyRes.headers["content-type"] || "");
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["x-frame-options"];
      delete responseHeaders["content-security-policy"];
      delete responseHeaders["content-length"];

      if (contentType.includes("text/html")) {
        let body = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", (chunk) => {
          body += chunk;
        });
        proxyRes.on("end", () => {
          const output = injectChrome(body);
          responseHeaders["content-length"] = Buffer.byteLength(output);
          res.writeHead(proxyRes.statusCode || 200, responseHeaders);
          res.end(output);
        });
        return;
      }

      res.writeHead(proxyRes.statusCode || 200, responseHeaders);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", () => {
    if (fallbackTarget) {
      proxyHttp(req, res, fallbackTarget, null);
      return;
    }
    try {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("upstream unavailable");
    } catch {}
  });

  req.pipe(proxyReq, { end: true });
}

function proxyUpgrade(req, socket, head, target, fallbackTarget) {
  const upstream = net.connect(target.port, target.host, () => {
    const headerLines = [
      req.method + " " + req.url + " HTTP/" + req.httpVersion,
      "Host: " + target.host + ":" + target.port,
      ...Object.entries(req.headers)
        .filter(([key]) => key.toLowerCase() !== "host")
        .map(([key, value]) => key + ": " + value),
      "",
      "",
    ].join("\r\n");

    upstream.write(headerLines);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => {
    if (fallbackTarget) {
      proxyUpgrade(req, socket, head, fallbackTarget, null);
      return;
    }
    socket.destroy();
  });

  socket.on("error", () => upstream.destroy());
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  if (pathname === "/healthz") {
    healthz(res);
    return;
  }

  if (isOpenClawSpecificPath(pathname)) {
    proxyHttp(req, res, { host: OPENCLAW_HOST, port: OPENCLAW_PORT }, null);
    return;
  }

  proxyHttp(
    req,
    res,
    { host: HERMES_HOST, port: HERMES_PORT },
    { host: OPENCLAW_HOST, port: OPENCLAW_PORT },
  );
});

server.on("upgrade", (req, socket, head) => {
  proxyUpgrade(
    req,
    socket,
    head,
    { host: HERMES_HOST, port: HERMES_PORT },
    { host: OPENCLAW_HOST, port: OPENCLAW_PORT },
  );
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(\`wrapper:\${LISTEN_PORT} -> hermes:\${HERMES_PORT} (fallback openclaw:\${OPENCLAW_PORT})\`);
});
`;

export const CLAWD_RUNTIME_WRAPPER_B64 = Buffer.from(
  CLAWD_RUNTIME_WRAPPER_SOURCE,
  "utf8",
).toString("base64");

export function buildClawdRuntimeWrapperStartCommand(
  wrapperDir = "/home/node/wrapper",
): string {
  return (
    `mkdir -p ${wrapperDir} && ` +
    `echo '${CLAWD_RUNTIME_WRAPPER_B64}' | base64 -d > ${wrapperDir}/server.js && ` +
    `pkill -f 'wrapper/server.js' 2>/dev/null || true; sleep 1; ` +
    `nohup node ${wrapperDir}/server.js > /tmp/wrapper.log 2>&1 &`
  );
}
