"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type BridgeToken = {
  id: string;
  deviceName: string;
  createdAt: string | null;
  expiresAt: string | null;
};

type GeneratedToken = {
  token: string;
  expiresAt: string;
  deviceName: string;
};

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export function BridgePanel() {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<BridgeToken[]>([]);
  const [generated, setGenerated] = useState<GeneratedToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const connectedDevice = tokens[0]?.deviceName || null;

  const installCommand = useMemo(() => {
    if (!generated?.token) return "";
    return `npm install -g clawd-bridge && clawd-bridge config --set token=${generated.token} && clawd-bridge connect`;
  }, [generated]);

  const fetchTokens = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/bridge/token/list", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load bridge tokens");
      }
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bridge tokens");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const copyText = async (text: string, setCopied: (value: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Unable to copy. Please copy manually.");
    }
  };

  const generateToken = async () => {
    if (!user) return;
    setGenerating(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/bridge/token/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceName: "My Machine" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate token");
      }
      setGenerated({
        token: data.token,
        expiresAt: data.expiresAt,
        deviceName: data.deviceName || "My Machine",
      });
      await fetchTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate token");
    } finally {
      setGenerating(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    if (!user) return;
    setRevokingId(tokenId);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/bridge/token/revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tokenId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to revoke token");
      }
      await fetchTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="set-section">
      <div className="set-section-head">
        <p className="set-kicker">Bridge connection</p>
      </div>
      <p className="set-note">
        Status:{" "}
        <span className={connectedDevice ? "set-status-ok" : "set-status-muted"}>
          {connectedDevice ? `Connected: ${connectedDevice}` : "No connector connected"}
        </span>
      </p>
      <p className="set-note">Maximum of 5 active tokens. Revoke one before generating a new token.</p>

      <div className="set-subsection">
        <button onClick={generateToken} disabled={generating || tokens.length >= 5} className="set-btn-primary">
          {generating ? <Loader2 className="set-icon-sm set-spin" /> : null}
          {generating ? "Generating..." : "Generate Token"}
        </button>

        {generated && (
          <div className="set-token-reveal">
            <p className="set-token-warn">Copy this token now. It is only shown in full once.</p>
            <div className="set-token-row">
              <code className="set-token-code">{generated.token}</code>
              <button className="set-token-copy" onClick={() => copyText(generated.token, setCopiedToken)} aria-label="Copy token">
                {copiedToken ? <Check className="set-icon-sm" /> : <Copy className="set-icon-sm" />}
              </button>
            </div>
            <p className="set-note">Device: {generated.deviceName} · Expires: {formatDate(generated.expiresAt)}</p>

            <div className="set-terminal">
              <p className="set-terminal-comment">Install and connect:</p>
              <p className="set-terminal-cmd">{installCommand}</p>
            </div>
            <button className="set-token-copy" onClick={() => copyText(installCommand, setCopiedCommand)}>
              {copiedCommand ? "Copied command" : "Copy install command"}
            </button>
          </div>
        )}
      </div>

      <div className="set-subsection">
        {loading ? (
          <p className="set-empty">Loading bridge tokens...</p>
        ) : tokens.length === 0 ? (
          <p className="set-empty">No active bridge tokens.</p>
        ) : (
          <div className="set-table-wrap">
            <table className="set-bridge-table">
              <thead>
                <tr>
                  <th>Device name</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.deviceName}</td>
                    <td>{formatDate(token.createdAt)}</td>
                    <td>{formatDate(token.expiresAt)}</td>
                    <td className="set-bridge-actions">
                      <button
                        onClick={() => revokeToken(token.id)}
                        disabled={revokingId === token.id}
                        className="set-btn-danger-text"
                      >
                        {revokingId === token.id ? "Revoking..." : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && <p className="set-note set-text-danger">{error}</p>}
    </section>
  );
}
