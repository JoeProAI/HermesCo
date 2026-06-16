"use client";

/**
 * WorkspacePanel — file browser + preview link for the user's Daytona
 * workspace sandbox, shown on /agents. Brand tokens match the agents page.
 */

import { useCallback, useEffect, useState } from "react";

const T = {
  surface: "var(--color-surface)",
  border: "var(--color-border)",
  text: "var(--color-text)",
  textBright: "var(--color-text-bright)",
  dim: "var(--color-text-dim)",
  accent: "var(--color-hermes)",
  ok: "#22c55e",
  mono: "var(--font-mono, 'JetBrains Mono'), monospace",
};

interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

interface SandboxStatus {
  exists: boolean;
  state: string;
  sandboxId?: string;
  workspaceRoot?: string;
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspacePanel({
  getToken,
}: {
  getToken: () => Promise<string>;
}) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [tree, setTree] = useState<WorkspaceFileNode[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [port, setPort] = useState("3000");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const authedFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getToken();
      return fetch(url, {
        ...init,
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
      });
    },
    [getToken]
  );

  const loadStatus = useCallback(async () => {
    try {
      const res = await authedFetch("/api/launchpad/sandbox");
      if (res.ok) setStatus(await res.json());
    } catch {
      // transient -- leave last status
    }
  }, [authedFetch]);

  const loadTree = useCallback(
    async (dir?: string) => {
      setBusy("tree");
      setError(null);
      try {
        const qs = dir ? `?dir=${encodeURIComponent(dir)}` : "";
        const res = await authedFetch(`/api/launchpad/sandbox/tree${qs}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to list files");
          return;
        }
        setTree(data.tree || []);
        setCwd(data.cwd || null);
        setRoot(data.root || null);
      } catch {
        setError("Failed to list files");
      } finally {
        setBusy(null);
      }
    },
    [authedFetch]
  );

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function downloadFile(path: string) {
    setBusy(`dl-${path}`);
    try {
      const res = await authedFetch(
        `/api/launchpad/sandbox/files?path=${encodeURIComponent(path)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Download failed");
        return;
      }
      const blob = await res.blob();
      triggerDownload(blob, path.split("/").pop() || "file");
    } finally {
      setBusy(null);
    }
  }

  async function downloadArchive() {
    setBusy("archive");
    setError(null);
    try {
      const res = await authedFetch("/api/launchpad/sandbox/archive");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Archive failed");
        return;
      }
      const blob = await res.blob();
      const isZip = res.headers.get("content-type") === "application/zip";
      triggerDownload(blob, isZip ? "workspace.zip" : "workspace.tar.gz");
    } finally {
      setBusy(null);
    }
  }

  async function openPreview() {
    setBusy("preview");
    setError(null);
    try {
      const res = await authedFetch(`/api/launchpad/preview?port=${port}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Preview failed");
        return;
      }
      setPreviewUrl(data.url);
      window.open(data.url, "_blank", "noopener");
    } finally {
      setBusy(null);
      loadStatus();
    }
  }

  async function stopSandbox() {
    setBusy("stop");
    try {
      await authedFetch("/api/launchpad/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  const running = status?.state === "started";

  return (
    <section
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 4,
        padding: "26px 30px",
        marginTop: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, color: T.textBright, fontSize: 18 }}>Workspace</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: T.mono, fontSize: 11 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: running ? T.ok : T.dim,
              boxShadow: running ? `0 0 8px ${T.ok}99` : "none",
            }}
          />
          <span style={{ color: running ? T.textBright : T.dim }}>
            {status === null ? "checking" : running ? "running" : status.exists ? status.state : "no sandbox yet"}
          </span>
        </div>
      </div>
      <p style={{ color: T.dim, fontSize: 13, lineHeight: 1.6, marginTop: 10, marginBottom: 18 }}>
        Files your agent builds live here. Browse and download them, or open a
        live preview of a dev server the agent started. Idle sandboxes stop
        automatically after 15 minutes.
      </p>

      {error && (
        <div style={{ fontFamily: T.mono, fontSize: 12, color: "#f87171", marginBottom: 14 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button style={btn()} disabled={busy === "tree"} onClick={() => loadTree()}>
          {busy === "tree" ? "Loading…" : "Browse files"}
        </button>
        <button style={btn()} disabled={busy === "archive"} onClick={downloadArchive}>
          {busy === "archive" ? "Packing…" : "Download all"}
        </button>
        {running && (
          <button style={btn()} disabled={busy === "stop"} onClick={stopSandbox}>
            {busy === "stop" ? "Stopping…" : "Stop sandbox"}
          </button>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 4))}
            style={{
              width: 64,
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 3,
              color: T.text,
              fontFamily: T.mono,
              fontSize: 12,
              padding: "7px 8px",
            }}
            aria-label="Preview port"
          />
          <button style={btn(true)} disabled={busy === "preview"} onClick={openPreview}>
            {busy === "preview" ? "Opening…" : "Open preview"}
          </button>
        </span>
      </div>

      {previewUrl && (
        <p style={{ fontFamily: T.mono, fontSize: 11, color: T.dim, margin: "0 0 14px" }}>
          preview:{" "}
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: T.accent }}>
            {previewUrl.replace(/^https?:\/\//, "")}
          </a>
        </p>
      )}

      {cwd && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 3 }}>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.dim, padding: "8px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cwd}</span>
            {root && cwd !== root && (
              <button
                style={{ marginLeft: "auto", background: "none", border: "none", color: T.accent, cursor: "pointer", fontFamily: T.mono, fontSize: 11, padding: 0 }}
                onClick={() => loadTree(cwd.substring(0, cwd.lastIndexOf("/")))}
              >
                up one level
              </button>
            )}
          </div>
          {tree.length === 0 ? (
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.dim, padding: "14px 12px" }}>
              Empty. Ask your agent to build something.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 320, overflowY: "auto" }}>
              {tree.map((node) => (
                <li
                  key={node.path}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderBottom: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 12 }}
                >
                  <span style={{ color: T.dim, width: 14 }}>{node.type === "dir" ? ">" : "·"}</span>
                  {node.type === "dir" ? (
                    <button
                      style={{ background: "none", border: "none", color: T.textBright, cursor: "pointer", fontFamily: T.mono, fontSize: 12, padding: 0 }}
                      onClick={() => loadTree(node.path)}
                    >
                      {node.name}/
                    </button>
                  ) : (
                    <span style={{ color: T.text }}>{node.name}</span>
                  )}
                  <span style={{ marginLeft: "auto", color: T.dim, fontSize: 11 }}>{fmtSize(node.size)}</span>
                  {node.type === "file" && (
                    <button
                      style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontFamily: T.mono, fontSize: 11, padding: 0 }}
                      disabled={busy === `dl-${node.path}`}
                      onClick={() => downloadFile(node.path)}
                    >
                      {busy === `dl-${node.path}` ? "…" : "download"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function btn(primary = false): React.CSSProperties {
  return {
    background: primary ? "var(--color-hermes)" : "transparent",
    color: primary ? "var(--color-bg)" : "var(--color-text)",
    border: primary ? "none" : `1px solid var(--color-border)`,
    borderRadius: 3,
    fontFamily: "var(--font-mono, 'JetBrains Mono'), monospace",
    fontSize: 12,
    letterSpacing: "0.04em",
    padding: "8px 14px",
    cursor: "pointer",
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
