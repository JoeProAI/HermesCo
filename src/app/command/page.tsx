"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type {
  AgentEvent,
  AgentTurnResult,
  ModelKey,
  Proposal,
  TreasuryState,
} from "@/lib/hermesco/types";
import { useIdentity, type Identity } from "@/lib/hermesco/useIdentity";

const INK = "#0E0E10";
const SURFACE = "#131316";
const GOLD = "#E0A35A";
const GOLD_DEEP = "#C8893E";
const CREAM = "#EDE6D9";
const TEAL = "#5BD6C0";
const DANGER = "#ef4444";
const SUCCESS = "#22c55e";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface LogEntry {
  who: "you" | "hermes";
  text?: string;
  events?: AgentEvent[];
}

const PRESETS = [
  "Launch a $20 logo-design service, take a test payment from a client, then get the design tool you need to deliver.",
  "You need a premium API to deliver a client report. Check the treasury, then propose the spend you need.",
  "Submit a proposal to spend $120 on a GPU server from CoreWeave — don't refuse it yourself, let the Treasury rule on it so I can watch the NemoClaw cap refuse it.",
];

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CommandCenter() {
  const identity = useIdentity();
  const workspaceId = identity.workspaceId;

  const [state, setState] = useState<TreasuryState | null>(null);
  const [model, setModel] = useState<ModelKey>("hermes");
  const [input, setInput] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId || workspaceId === "g_server") return;
    const res = await fetch(
      `/api/hermesco/treasury?workspaceId=${encodeURIComponent(workspaceId)}`,
      { cache: "no-store" },
    );
    if (res.ok) setState((await res.json()) as TreasuryState);
  }, [workspaceId]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("hermesco-entered")) {
      setEntered(true);
    }
  }, []);

  useEffect(() => {
    if (!identity.ready) return;
    setState(null);
    setLog([]);
    setHistory([]);
    void refresh();
  }, [identity.ready, workspaceId, refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setInput("");
    setLog((l) => [...l, { who: "you", text: message }]);
    try {
      const res = await fetch("/api/hermesco/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, model, message, history }),
      });
      const data = (await res.json()) as AgentTurnResult & { error?: string };
      if (data.error) {
        setLog((l) => [...l, { who: "hermes", text: `Error: ${data.error}` }]);
      } else {
        setLog((l) => [...l, { who: "hermes", events: data.events, text: data.assistant }]);
        setState(data.state);
        setHistory((h) => [
          ...h,
          { role: "user", content: message },
          { role: "assistant", content: data.assistant || "(awaiting approval)" },
        ]);
      }
    } catch (err) {
      setLog((l) => [...l, { who: "hermes", text: `Network error: ${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(proposalId: string, decision: "approve" | "deny") {
    setDeciding(proposalId);
    try {
      const res = await fetch("/api/hermesco/treasury/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, proposalId, decision, operator: identity.name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { state: TreasuryState };
        setState(data.state);
      }
    } finally {
      setDeciding(null);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch("/api/hermesco/treasury/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (res.ok) setState((await res.json()) as TreasuryState);
      setLog([]);
      setHistory([]);
    } finally {
      setBusy(false);
    }
  }

  async function doSignIn() {
    setAuthMsg(null);
    const r = await identity.signInGoogle();
    if (r.ok) {
      setEntered(true);
      if (typeof window !== "undefined") window.localStorage.setItem("hermesco-entered", "1");
    } else if (r.error) {
      setAuthMsg(r.error);
    }
  }

  function continueAsGuest() {
    setEntered(true);
    if (typeof window !== "undefined") window.localStorage.setItem("hermesco-entered", "1");
  }

  const showGate = identity.ready && identity.kind === "guest" && !entered;
  const pending = state?.proposals.filter((p) => p.status === "pending") ?? [];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: INK,
        color: CREAM,
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(800px 500px at 85% 0%, rgba(200,137,62,0.12), transparent 60%)",
        }}
      />
      {showGate && (
        <EntryGate onGuest={continueAsGuest} onGoogle={doSignIn} authMsg={authMsg} />
      )}
      {/* top bar */}
      <header
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px clamp(16px, 3vw, 32px)",
          borderBottom: "1px solid rgba(237,230,217,0.08)",
        }}
      >
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: CREAM }}
        >
          <Image src="/hermes-emblem.png" alt="HermesCo" width={30} height={30} />
          <span style={{ fontFamily: "var(--font-editorial-serif)", fontSize: 19 }}>
            Hermes<span style={{ color: GOLD }}>Co</span>
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              color: "rgba(237,230,217,0.45)",
              marginLeft: 6,
            }}
          >
            COMMAND CENTER
          </span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IdentityControl identity={identity} onSignIn={doSignIn} />
          <ModelToggle model={model} setModel={setModel} disabled={busy} />
          <button
            onClick={reset}
            disabled={busy}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "rgba(237,230,217,0.7)",
              background: "transparent",
              border: "1px solid rgba(237,230,217,0.16)",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: busy ? "default" : "pointer",
            }}
          >
            Reset demo
          </button>
        </div>
      </header>

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 460px)",
          gap: 0,
          height: "calc(100vh - 63px)",
        }}
      >
        {/* AGENT COLUMN */}
        <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            ref={logRef}
            style={{ flex: 1, overflowY: "auto", padding: "22px clamp(16px, 3vw, 32px)" }}
          >
            {log.length === 0 && (
              <div style={{ maxWidth: 560, margin: "8vh auto 0", textAlign: "center" }}>
                <Image src="/hermes-emblem.png" alt="" width={64} height={64} style={{ opacity: 0.9 }} />
                <h2
                  style={{
                    fontFamily: "var(--font-editorial-serif)",
                    fontWeight: 400,
                    fontSize: 28,
                    margin: "16px 0 8px",
                  }}
                >
                  Give Hermes a business goal.
                </h2>
                <p style={{ color: "rgba(237,230,217,0.55)", fontSize: 15, marginBottom: 22 }}>
                  It will earn, spend, and operate — pausing for your approval whenever real money is
                  on the line.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => send(p)}
                      disabled={busy}
                      style={{
                        textAlign: "left",
                        fontFamily: "var(--font-body)",
                        fontSize: 14,
                        color: CREAM,
                        background: "rgba(255,255,255,0.025)",
                        border: "1px solid rgba(237,230,217,0.12)",
                        borderRadius: 10,
                        padding: "12px 16px",
                        cursor: busy ? "default" : "pointer",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {log.map((entry, i) =>
              entry.who === "you" ? (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end", margin: "14px 0" }}>
                  <div
                    style={{
                      background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
                      color: INK,
                      padding: "10px 16px",
                      borderRadius: "14px 14px 4px 14px",
                      maxWidth: "78%",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {entry.text}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ margin: "14px 0" }}>
                  {entry.events && <EventStream events={entry.events} />}
                  {entry.text && (
                    <div
                      style={{
                        background: SURFACE,
                        border: "1px solid rgba(237,230,217,0.10)",
                        padding: "12px 16px",
                        borderRadius: "4px 14px 14px 14px",
                        maxWidth: "85%",
                        fontSize: 14.5,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                        marginTop: entry.events?.length ? 10 : 0,
                      }}
                    >
                      {entry.text}
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div style={{ display: "flex", gap: 7, alignItems: "center", margin: "14px 4px", color: "rgba(237,230,217,0.5)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                <Dot /> <Dot d={0.2} /> <Dot d={0.4} /> Hermes is working…
              </div>
            )}
          </div>

          {/* composer */}
          <div
            style={{
              borderTop: "1px solid rgba(237,230,217,0.08)",
              padding: "14px clamp(16px, 3vw, 32px)",
              display: "flex",
              gap: 10,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Tell Hermes what to do…"
              disabled={busy}
              style={{
                flex: 1,
                background: SURFACE,
                border: "1px solid rgba(237,230,217,0.14)",
                borderRadius: 10,
                padding: "13px 16px",
                color: CREAM,
                fontSize: 14.5,
                fontFamily: "var(--font-body)",
                outline: "none",
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              style={{
                background: busy || !input.trim() ? "rgba(237,230,217,0.12)" : `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
                color: busy || !input.trim() ? "rgba(237,230,217,0.4)" : INK,
                border: "none",
                borderRadius: 10,
                padding: "0 22px",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                cursor: busy || !input.trim() ? "default" : "pointer",
              }}
            >
              Send
            </button>
          </div>
        </section>

        {/* TREASURY COLUMN */}
        <aside
          style={{
            borderLeft: "1px solid rgba(237,230,217,0.08)",
            background: "rgba(0,0,0,0.25)",
            overflowY: "auto",
            padding: "20px clamp(16px, 2vw, 24px)",
          }}
        >
          <TreasuryPanel
            state={state}
            pending={pending}
            deciding={deciding}
            onDecide={decide}
          />
        </aside>
      </div>
    </main>
  );
}

function ModelToggle({
  model,
  setModel,
  disabled,
}: {
  model: ModelKey;
  setModel: (m: ModelKey) => void;
  disabled: boolean;
}) {
  const opts: { key: ModelKey; label: string }[] = [
    { key: "hermes", label: "Hermes 4" },
    { key: "nemotron", label: "Nemotron 3" },
  ];
  return (
    <div
      style={{
        display: "flex",
        border: "1px solid rgba(237,230,217,0.16)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => !disabled && setModel(o.key)}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            padding: "8px 12px",
            border: "none",
            cursor: disabled ? "default" : "pointer",
            background: model === o.key ? `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})` : "transparent",
            color: model === o.key ? INK : "rgba(237,230,217,0.7)",
            fontWeight: model === o.key ? 700 : 400,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IdentityControl({ identity, onSignIn }: { identity: Identity; onSignIn: () => void }) {
  if (!identity.ready) return null;
  if (identity.kind === "user") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: SUCCESS,
            boxShadow: `0 0 8px ${SUCCESS}`,
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: CREAM,
            maxWidth: 150,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {identity.name}
        </span>
        <button
          onClick={() => void identity.signOut()}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "rgba(237,230,217,0.5)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Sign out
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onSignIn}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "rgba(237,230,217,0.7)",
        background: "transparent",
        border: "1px solid rgba(237,230,217,0.16)",
        borderRadius: 8,
        padding: "8px 12px",
        cursor: "pointer",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: GOLD }} />
      Guest · Sign in
    </button>
  );
}

function EntryGate({
  onGuest,
  onGoogle,
  authMsg,
}: {
  onGuest: () => void;
  onGoogle: () => void;
  authMsg: string | null;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(8,8,10,0.82)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: SURFACE,
          border: "1px solid rgba(200,137,62,0.28)",
          borderRadius: 16,
          padding: "34px 30px",
          textAlign: "center",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <Image src="/hermes-emblem.png" alt="HermesCo" width={56} height={56} style={{ margin: "0 auto" }} />
        <h2
          style={{
            fontFamily: "var(--font-editorial-serif)",
            fontWeight: 400,
            fontSize: 26,
            margin: "16px 0 6px",
            color: CREAM,
          }}
        >
          Enter the Command Center
        </h2>
        <p style={{ color: "rgba(237,230,217,0.55)", fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
          Drive an autonomous business in real time. Continue as a guest to try it instantly, or sign
          in to keep a named operator on your approval ledger.
        </p>
        <button
          onClick={onGuest}
          style={{
            width: "100%",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 14,
            color: INK,
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
            border: "none",
            borderRadius: 10,
            padding: "13px",
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          Continue as guest →
        </button>
        <button
          onClick={onGoogle}
          style={{
            width: "100%",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: CREAM,
            background: "transparent",
            border: "1px solid rgba(237,230,217,0.18)",
            borderRadius: 10,
            padding: "12px",
            cursor: "pointer",
          }}
        >
          Continue with Google
        </button>
        {authMsg && (
          <p style={{ color: DANGER, fontSize: 12, marginTop: 14, fontFamily: "var(--font-mono)" }}>
            {authMsg}
          </p>
        )}
        <p
          style={{
            color: "rgba(237,230,217,0.3)",
            fontSize: 11,
            marginTop: 20,
            fontFamily: "var(--font-mono)",
          }}
        >
          No card. Test mode. Every move is policy-bounded.
        </p>
      </div>
    </div>
  );
}

function EventStream({ events }: { events: AgentEvent[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "85%" }}>
      {events
        .filter((e) => e.kind !== "message")
        .map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
    </div>
  );
}

function EventRow({ e }: { e: AgentEvent }) {
  const base = {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    borderRadius: 8,
    padding: "8px 12px",
    border: "1px solid rgba(237,230,217,0.08)",
    color: "rgba(237,230,217,0.72)",
    background: "rgba(255,255,255,0.02)",
    wordBreak: "break-word" as const,
  };
  if (e.kind === "thought")
    return <div style={{ ...base, fontStyle: "italic", color: "rgba(237,230,217,0.55)" }}>{e.text}</div>;
  if (e.kind === "tool_call")
    return (
      <div style={{ ...base, borderColor: "rgba(91,214,192,0.3)", color: TEAL }}>
        ⚡ {e.toolName}({fmtArgs(e.toolArgs)})
      </div>
    );
  if (e.kind === "tool_result")
    return <div style={{ ...base, color: "rgba(237,230,217,0.6)" }}>↳ {truncate(e.text ?? "", 220)}</div>;
  if (e.kind === "proposal")
    return <div style={{ ...base, borderColor: "rgba(200,137,62,0.32)", color: GOLD }}>◆ {e.text}</div>;
  if (e.kind === "awaiting_approval")
    return (
      <div style={{ ...base, borderColor: "rgba(245,158,11,0.5)", color: "#F59E0B", fontWeight: 600 }}>
        ⏸ Awaiting your approval in the Treasury →
      </div>
    );
  if (e.kind === "error") return <div style={{ ...base, color: DANGER }}>✕ {e.text}</div>;
  return null;
}

function TreasuryPanel({
  state,
  pending,
  deciding,
  onDecide,
}: {
  state: TreasuryState | null;
  pending: Proposal[];
  deciding: string | null;
  onDecide: (id: string, d: "approve" | "deny") => void;
}) {
  if (!state) return <div style={{ color: "rgba(237,230,217,0.5)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Loading Treasury…</div>;

  const profitColor = state.netProfitUsd > 0 ? SUCCESS : state.netProfitUsd < 0 ? DANGER : CREAM;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontFamily: "var(--font-editorial-serif)", fontWeight: 400, fontSize: 20, margin: 0 }}>
          Treasury
        </h3>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.1em",
            color: state.stripeMode === "test" ? TEAL : state.stripeMode === "live" ? GOLD : "rgba(237,230,217,0.4)",
            border: `1px solid ${state.stripeMode === "none" ? "rgba(237,230,217,0.18)" : "rgba(91,214,192,0.4)"}`,
            borderRadius: 999,
            padding: "3px 9px",
          }}
        >
          STRIPE: {state.stripeMode.toUpperCase()}
        </span>
      </div>

      {/* headline numbers */}
      <div
        style={{
          border: "1px solid rgba(237,230,217,0.10)",
          borderRadius: 14,
          padding: "18px 18px",
          background: "linear-gradient(180deg, rgba(200,137,62,0.06), rgba(255,255,255,0))",
        }}
      >
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(237,230,217,0.5)", letterSpacing: "0.1em" }}>
          BALANCE
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 34, fontWeight: 600, color: CREAM, marginTop: 2 }}>
          {money(state.balanceUsd)}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
          <Metric label="Revenue" value={money(state.revenueUsd)} color={SUCCESS} />
          <Metric label="Spend" value={money(state.expenseUsd)} color="rgba(237,230,217,0.8)" />
          <Metric label="Net profit" value={money(state.netProfitUsd)} color={profitColor} />
        </div>
      </div>

      {/* caps */}
      <div style={{ border: "1px solid rgba(237,230,217,0.10)", borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(237,230,217,0.5)", letterSpacing: "0.1em", marginBottom: 10 }}>
          HARD CAPS · ENFORCED IN CODE
        </div>
        <CapRow label="Max per action" value={money(state.budget.maxSpendPerActionUsd)} />
        <CapRow label="Auto-approve under" value={money(state.budget.autoApproveUnderUsd)} />
        <CapRow label="Daily cap" value={`${money(state.spentTodayUsd)} / ${money(state.budget.dailySpendCapUsd)}`} />
        <CapRow label="Min reserve" value={money(state.budget.minReserveUsd)} last />
      </div>

      {/* pending approvals */}
      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#F59E0B", letterSpacing: "0.1em" }}>
            ⏸ AWAITING APPROVAL ({pending.length})
          </div>
          {pending.map((p) => (
            <div
              key={p.id}
              style={{
                border: "1px solid rgba(245,158,11,0.4)",
                borderRadius: 12,
                padding: "14px 16px",
                background: "rgba(245,158,11,0.05)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: GOLD, fontWeight: 600 }}>
                  {money(p.amountUsd)}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "rgba(237,230,217,0.6)", margin: "4px 0 6px" }}>
                → {p.counterparty}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "rgba(237,230,217,0.5)", marginBottom: 12 }}>
                {p.safetyReason}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => onDecide(p.id, "approve")}
                  disabled={deciding === p.id}
                  style={{
                    flex: 1,
                    background: `linear-gradient(135deg, ${SUCCESS}, #16a34a)`,
                    color: "#04210f",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 0",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => onDecide(p.id, "deny")}
                  disabled={deciding === p.id}
                  style={{
                    flex: 1,
                    background: "transparent",
                    color: DANGER,
                    border: `1px solid ${DANGER}`,
                    borderRadius: 8,
                    padding: "9px 0",
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ledger */}
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(237,230,217,0.5)", letterSpacing: "0.1em", marginBottom: 10 }}>
          LEDGER
        </div>
        {state.ledger.length === 0 ? (
          <div style={{ fontSize: 13, color: "rgba(237,230,217,0.4)", fontFamily: "var(--font-mono)" }}>
            No transactions yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.ledger.map((e) => (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  border: "1px solid rgba(237,230,217,0.08)",
                  borderRadius: 9,
                  background: "rgba(255,255,255,0.015)",
                }}
              >
                <span style={{ fontSize: 13, color: "rgba(237,230,217,0.78)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.description}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: e.amountUsd >= 0 ? SUCCESS : "rgba(237,230,217,0.85)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.amountUsd >= 0 ? "+" : ""}
                  {money(e.amountUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "rgba(237,230,217,0.35)",
          textAlign: "center",
          marginTop: 4,
          lineHeight: 1.7,
        }}
      >
        NemoClaw safety screening · NVIDIA Nemotron
        <br />
        Engine: Cognition AI · Devin
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "rgba(237,230,217,0.45)", letterSpacing: "0.08em" }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600, color, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function CapRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: last ? "none" : "1px solid rgba(237,230,217,0.06)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "rgba(237,230,217,0.6)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", color: CREAM }}>{value}</span>
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: GOLD,
        display: "inline-block",
        animation: `hc-pulse 1s ${d}s infinite ease-in-out`,
      }}
    />
  );
}

function fmtArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? `"${truncate(v, 40)}"` : String(v)}`)
    .join(", ");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
