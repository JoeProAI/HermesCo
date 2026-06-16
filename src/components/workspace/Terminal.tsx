"use client";

import { useEffect, useRef, useState } from "react";

interface TerminalProps {
  userId?: string;
  onResize?: (cols: number, rows: number) => void;
}

export function Terminal({ userId }: TerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cleanup = false;

    const initTerminal = async () => {
      if (!termRef.current || cleanup) return;

      try {
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        const { WebLinksAddon } = await import("@xterm/addon-web-links");

        // xterm CSS is loaded via link tag or global import

        if (cleanup) return;

        const fitAddon = new FitAddon();

        const term = new Terminal({
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 13,
          lineHeight: 1.5,
          cursorBlink: true,
          cursorStyle: "bar",
          theme: {
            background: "#09090b",
            foreground: "#d4d4d8",
            cursor: "#F59E0B",
            cursorAccent: "#09090b",
            selectionBackground: "rgba(245, 158, 11, 0.3)",
            selectionForeground: "#fafafa",
            black: "#09090b",
            red: "#ef4444",
            green: "#22c55e",
            yellow: "#F59E0B",
            blue: "#3b82f6",
            magenta: "#a855f7",
            cyan: "#06b6d4",
            white: "#d4d4d8",
            brightBlack: "#52525b",
            brightRed: "#f87171",
            brightGreen: "#4ade80",
            brightYellow: "#FBBF24",
            brightBlue: "#60a5fa",
            brightMagenta: "#c084fc",
            brightCyan: "#22d3ee",
            brightWhite: "#fafafa",
          },
        });

        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(termRef.current);
        fitAddon.fit();
        xtermRef.current = { term, fitAddon };

        // Resize observer
        const observer = new ResizeObserver(() => {
          try { fitAddon.fit(); } catch {}
        });
        observer.observe(termRef.current);

        // Try to connect WebSocket to sandbox
        if (userId) {
          try {
            const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/sandbox/terminal?userId=${userId}`);

            ws.onopen = () => {
              setConnected(true);
              setLoading(false);
              // Send terminal dimensions
              ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
            };

            ws.onmessage = (event) => {
              term.write(event.data);
            };

            ws.onerror = () => {
              setConnected(false);
              setLoading(false);
              showWelcome(term);
            };

            ws.onclose = () => {
              setConnected(false);
            };

            term.onData((data) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "input", data }));
              }
            });

            term.onResize(({ cols, rows }) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "resize", cols, rows }));
              }
            });
          } catch {
            setLoading(false);
            showWelcome(term);
          }
        } else {
          setLoading(false);
          showWelcome(term);
        }

        return () => {
          observer.disconnect();
          term.dispose();
        };
      } catch (err) {
        setError("Failed to load terminal");
        setLoading(false);
      }
    };

    initTerminal();

    return () => {
      cleanup = true;
      if (xtermRef.current) {
        xtermRef.current.term.dispose();
      }
    };
  }, [userId]);

  return (
    <div className="flex flex-col h-full bg-base">
      {/* Terminal Header */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs select-none shrink-0 border-b-default bg-surface"
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-danger" />
            <span className="w-2.5 h-2.5 rounded-full bg-warning" />
            <span className="w-2.5 h-2.5 rounded-full bg-success" />
          </div>
          <span className="font-mono ml-2 text-muted">
            terminal
          </span>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1.5 font-mono" style={{ color: "#22c55e" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              connected
            </span>
          ) : loading ? (
            <span className="font-mono text-muted">connecting...</span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-muted">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-muted)" }} />
              local
            </span>
          )}
        </div>
      </div>

      {/* Terminal Content */}
      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm font-mono text-danger">{error}</p>
        </div>
      ) : (
        <div ref={termRef} className="flex-1 p-2 bg-base" />
      )}
    </div>
  );
}

function showWelcome(term: any) {
  const amber = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const bright = "\x1b[1m";

  term.writeln("");
  term.writeln(`  ${bright}${amber}clawd.run${reset} ${dim}workspace terminal${reset}`);
  term.writeln("");
  term.writeln(`  ${dim}Live sandbox terminal is enabled on invited accounts.${reset}`);
  term.writeln(`  ${dim}Persistent filesystem, code execution, and tools are ready when enabled.${reset}`);
  term.writeln("");
  term.writeln(`  ${amber}Features:${reset}`);
  term.writeln(`  ${dim}  - Full bash/python/node access${reset}`);
  term.writeln(`  ${dim}  - Persistent workspace files${reset}`);
  term.writeln(`  ${dim}  - Install packages and run scripts${reset}`);
  term.writeln(`  ${dim}  - Tmux-style split panes (coming soon)${reset}`);
  term.writeln("");
}
