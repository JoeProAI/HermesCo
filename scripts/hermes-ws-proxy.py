#!/usr/bin/env python3
"""
Tiny header-injecting reverse proxy for the Hermes dashboard.

Why this exists
---------------
Hermes secure mode authenticates with an `X-Hermes-Session-Token` HTTP header.
The dashboard sends it on every /api call. But a browser CANNOT set custom
headers on a WebSocket handshake, so the live "events feed" WS falls back to
`?token=<t>` in the URL — which Hermes secure mode rejects (401). That's why
chat works on localhost (same-origin gets a pass) but dies behind any proxy.

This proxy sits between the Cloudflare tunnel and Hermes:
  browser --(wss, ?token=)--> cloudflared --> THIS PROXY :8081 --> Hermes :8082
It reads `?token=` off the request, injects it as the `X-Hermes-Session-Token`
header, rewrites Host to what Hermes bound to, and pipes the connection
(handling the WebSocket upgrade transparently).

Zero dependencies — Python stdlib only.
"""
import socket
import threading
import re

LISTEN_HOST, LISTEN_PORT = "127.0.0.1", 8081
TARGET_HOST, TARGET_PORT = "127.0.0.1", 8082
TARGET_HOST_HEADER = "127.0.0.1:8082"

CRLF = b"\r\n"
TOKEN_RE = re.compile(rb"[?&]token=([^&\s]+)")


def pipe(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except Exception:
            pass


def handle(client):
    upstream = None
    try:
        buf = b""
        while CRLF + CRLF not in buf:
            chunk = client.recv(4096)
            if not chunk:
                return
            buf += chunk
            if len(buf) > 65536:
                return
        head, rest = buf.split(CRLF + CRLF, 1)
        lines = head.split(CRLF)
        request_line = lines[0]
        headers = lines[1:]

        is_upgrade = any(
            h.lower().startswith(b"upgrade:") and b"websocket" in h.lower()
            for h in headers
        )
        m = TOKEN_RE.search(request_line)
        token = m.group(1) if m else None

        rebuilt = []
        has_token_hdr = False
        for h in headers:
            low = h.lower()
            if low.startswith(b"host:"):
                rebuilt.append(b"Host: " + TARGET_HOST_HEADER.encode())
            elif low.startswith(b"x-hermes-session-token:"):
                has_token_hdr = True
                rebuilt.append(h)
            elif low.startswith(b"connection:") and not is_upgrade:
                continue  # drop; we'll force close on plain HTTP
            else:
                rebuilt.append(h)

        if token and not has_token_hdr:
            rebuilt.append(b"X-Hermes-Session-Token: " + token)
        if not is_upgrade:
            rebuilt.append(b"Connection: close")

        new_head = CRLF.join([request_line] + rebuilt) + CRLF + CRLF

        upstream = socket.create_connection((TARGET_HOST, TARGET_PORT))
        upstream.sendall(new_head + rest)

        t1 = threading.Thread(target=pipe, args=(client, upstream), daemon=True)
        t2 = threading.Thread(target=pipe, args=(upstream, client), daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception:
        pass
    finally:
        for s in (client, upstream):
            try:
                if s:
                    s.close()
            except Exception:
                pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LISTEN_HOST, LISTEN_PORT))
    srv.listen(128)
    print(f"ws-proxy listening on {LISTEN_HOST}:{LISTEN_PORT} -> {TARGET_HOST}:{TARGET_PORT}", flush=True)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()


if __name__ == "__main__":
    main()
