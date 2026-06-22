"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  AgentEvent,
  AgentTurnResult,
  Job,
  JobStatus,
  Proposal,
  TreasuryState,
} from "@/lib/hermesco/types";
import type { AgentMachine } from "@/lib/hermesco/fly";
import { useIdentity, type Identity } from "@/lib/hermesco/useIdentity";
import MessengerNetwork from "@/components/MessengerNetwork";
import HermesMark from "@/components/HermesMark";

const INK = "#0E0E10";
const SURFACE = "#131316";
const GOLD = "#E0A35A";
const GOLD_DEEP = "#C8893E";
const CREAM = "#EDE6D9";
const TEAL = "#5BD6C0";
const BLUE = "#6E97FF";
const NVIDIA = "#76B900";
const DANGER = "#ef4444";
const SUCCESS = "#22c55e";
const WARN = "#F59E0B";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface LogEntry {
  who: "you" | "hermes";
  text?: string;
  events?: AgentEvent[];
}

interface FleetData {
  configured: boolean;
  spec: {
    image: string;
    cpuKind: string;
    cpus: number;
    memoryMb: number;
    region: string;
    app: string;
  } | null;
  machines: AgentMachine[];
  error: string | null;
}

// Real business directives, not demo scripts. Each one exercises the full
// pipeline: Hermes decides, Nemotron screens, Stripe settles, on a Fly machine.
const PRESETS = [
  "A customer needs the headings and links from https://news.ycombinator.com as clean JSON. Quote a Web Extract job, then deliver it once they pay.",
  "Quote a Repo Pack job for https://github.com/sindresorhus/slugify so a customer can size up the codebase, then fulfil it after the payment lands.",
  "Propose a $120 per month CoreWeave GPU server to expand capacity. Route it through the Treasury for a decision before any money moves.",
];

// The service catalog shape returned by GET /api/hermesco/jobs (mirrors
// serviceCatalog() in services.ts). Kept local so this client bundle does not
// pull in the node-only service implementations.
interface ServiceCatalogItem {
  key: string;
  name: string;
  tagline: string;
  deliverable: string;
  brief: string;
  suggested_price_usd: number;
}

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function stateMeta(state: string): { label: string; color: string } {
  switch (state) {
    case "started":
      return { label: "RUNNING", color: SUCCESS };
    case "starting":
    case "created":
    case "replacing":
      return { label: "BOOTING", color: WARN };
    case "suspended":
      return { label: "SUSPENDED · $0", color: TEAL };
    case "stopped":
      return { label: "STOPPED", color: "rgba(237,230,217,0.55)" };
    case "destroying":
    case "destroyed":
      return { label: "DESTROYED", color: DANGER };
    default:
      return { label: state.toUpperCase(), color: "rgba(237,230,217,0.6)" };
  }
}

function fmtUptime(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function CommandCenter() {
  const identity = useIdentity();
  const workspaceId = identity.workspaceId;

  // Helper: build auth headers for API calls (empty object for guests)
  async function authHeaders(): Promise<Record<string, string>> {
    const token = await identity.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  const [state, setState] = useState<TreasuryState | null>(null);
  const [input, setInput] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [depositing, setDepositing] = useState(false);
  const [depositMsg, setDepositMsg] = useState<string | null>(null);

  const [fleet, setFleet] = useState<FleetData>({
    configured: false,
    spec: null,
    machines: [],
    error: null,
  });
  const [provisioning, setProvisioning] = useState(false);
  const [machineBusy, setMachineBusy] = useState<Record<string, string>>({});

  const [jobs, setJobs] = useState<Job[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [jobBusy, setJobBusy] = useState<string | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const depositHandled = useRef(false);

  const refresh = useCallback(async () => {
    if (!workspaceId || workspaceId === "g_server") return;
    const res = await fetch(
      `/api/hermesco/treasury?workspaceId=${encodeURIComponent(workspaceId)}`,
      { cache: "no-store" },
    );
    if (res.ok) setState((await res.json()) as TreasuryState);
  }, [workspaceId]);

  const refreshFleet = useCallback(async () => {
    try {
      const hdrs = await authHeaders();
      const res = await fetch("/api/hermesco/agents", {
        cache: "no-store",
        headers: hdrs,
      });
      if (res.status === 401) {
        setFleet((f) => ({ ...f, error: "Sign in to view fleet" }));
        return;
      }
      const data = (await res.json()) as Partial<FleetData> & { error?: string };
      setFleet({
        configured: !!data.configured,
        spec: data.spec ?? null,
        machines: Array.isArray(data.machines) ? data.machines : [],
        error: data.error ?? null,
      });
    } catch (err) {
      setFleet((f) => ({ ...f, error: String(err) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const refreshJobs = useCallback(async () => {
    if (!workspaceId || workspaceId === "g_server") return;
    try {
      const res = await fetch(
        `/api/hermesco/jobs?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        jobs?: Job[];
        services?: ServiceCatalogItem[];
      };
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (Array.isArray(data.services)) setServices(data.services);
    } catch {
      // non-fatal: the order book just stays as-is until the next refresh
    }
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
    setJobs([]);
    void refresh();
    void refreshJobs();
  }, [identity.ready, workspaceId, refresh, refreshJobs]);

  // Live fleet polling: surface real Fly machines as they boot, suspend, or wake.
  useEffect(() => {
    if (!entered || !identity.ready) return;
    void refreshFleet();
    const t = setInterval(() => void refreshFleet(), 6000);
    return () => clearInterval(t);
  }, [entered, identity.ready, refreshFleet]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log, busy]);

  // Returning from Stripe Checkout: confirm the deposit and credit the Treasury.
  useEffect(() => {
    if (!workspaceId || workspaceId === "g_server" || depositHandled.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("deposit_session");
    const cancelled = url.searchParams.get("deposit_cancelled");
    if (!sessionId && !cancelled) return;
    depositHandled.current = true;
    url.searchParams.delete("deposit_session");
    url.searchParams.delete("deposit_cancelled");
    window.history.replaceState({}, "", url.toString());
    if (cancelled) {
      setDepositMsg("Deposit cancelled.");
      return;
    }
    void (async () => {
      const res = await fetch(
        `/api/hermesco/treasury/deposit?session_id=${encodeURIComponent(sessionId!)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        paid?: boolean;
        depositedUsd?: number;
        state?: TreasuryState;
        error?: string;
      };
      if (data.error) setDepositMsg(data.error);
      else if (data.ok && data.state) {
        setState(data.state);
        setDepositMsg(`Deposited ${money(data.depositedUsd ?? 0)} into the Treasury.`);
      } else if (data.paid === false) {
        setDepositMsg("Payment not completed.");
      }
    })();
  }, [workspaceId]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setInput("");
    setLog((l) => [...l, { who: "you", text: message }]);
    try {
      const hdrs = await authHeaders();
      const res = await fetch("/api/hermesco/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdrs },
        body: JSON.stringify({ message, history }),
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
      void refreshFleet();
      void refreshJobs();
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
      void refreshJobs();
    }
  }

  // Quote a real customer job: stand up a Stripe payment link and add it to the
  // order book. Nothing is earned until the customer pays the link.
  async function quoteJob(input: { service: string; brief: string; priceUsd: number }) {
    setJobBusy("quote");
    setJobMsg(null);
    try {
      const res = await fetch("/api/hermesco/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "quote", ...input }),
      });
      const data = (await res.json()) as { job?: Job; state?: TreasuryState; error?: string };
      if (data.error) setJobMsg(data.error);
      else {
        if (data.state) setState(data.state);
        setJobMsg("Job quoted. Share the payment link with the customer, then deliver once paid.");
      }
    } catch (err) {
      setJobMsg(`Network error: ${String(err)}`);
    } finally {
      setJobBusy(null);
      void refreshJobs();
    }
  }

  // Fulfil a paid job: verify the Stripe payment, book the screened compute
  // spend, run the real work on the Fly machine, return the deliverable.
  async function deliverJob(jobId: string) {
    setJobBusy(jobId);
    setJobMsg(null);
    try {
      const res = await fetch("/api/hermesco/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "deliver", jobId }),
      });
      const data = (await res.json()) as {
        outcome?: string;
        message?: string;
        state?: TreasuryState;
        error?: string;
      };
      if (data.error) setJobMsg(data.error);
      else {
        if (data.state) setState(data.state);
        if (data.message) setJobMsg(data.message);
      }
    } catch (err) {
      setJobMsg(`Network error: ${String(err)}`);
    } finally {
      setJobBusy(null);
      void refreshFleet();
      void refreshJobs();
    }
  }

  async function deposit(amountUsd: number) {
    if (depositing) return;
    setDepositing(true);
    setDepositMsg(null);
    try {
      const res = await fetch("/api/hermesco/treasury/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, amountUsd }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setDepositMsg(data.error || "Could not start the deposit.");
    } catch (err) {
      setDepositMsg(`Network error: ${String(err)}`);
    } finally {
      setDepositing(false);
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
      setJobs([]);
      setJobMsg(null);
    } finally {
      setBusy(false);
      void refreshJobs();
    }
  }

  // Pre-warm a real, dedicated Fly machine as this workspace's agent body.
  async function provisionBody() {
    if (provisioning) return;
    setProvisioning(true);
    try {
      let lastUser = "";
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "user") {
          lastUser = history[i].content;
          break;
        }
      }
      const goal = (input.trim() || lastUser || "").slice(0, 200);
      const hdrs = await authHeaders();
      const res = await fetch("/api/hermesco/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdrs },
        body: JSON.stringify({ goal }),
      });
      await res.json().catch(() => undefined);
    } finally {
      setProvisioning(false);
      void refreshFleet();
    }
  }

  async function machineAction(id: string, action: "suspend" | "start") {
    setMachineBusy((m) => ({ ...m, [id]: action }));
    try {
      const hdrs = await authHeaders();
      const res = await fetch(`/api/hermesco/agents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdrs },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { machine?: AgentMachine };
      if (data.machine) {
        setFleet((f) => ({
          ...f,
          machines: f.machines.map((mc) => (mc.id === id ? data.machine! : mc)),
        }));
      }
    } finally {
      setMachineBusy((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      void refreshFleet();
    }
  }

  async function destroyMachine(id: string) {
    setMachineBusy((m) => ({ ...m, [id]: "destroy" }));
    try {
      const hdrs = await authHeaders();
      await fetch(`/api/hermesco/agents/${id}`, { method: "DELETE", headers: hdrs });
    } finally {
      setMachineBusy((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      void refreshFleet();
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
      <MessengerNetwork dim opacity={0.3} interactive={false} maxNodes={90} />
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            "radial-gradient(900px 600px at 85% -5%, rgba(200,137,62,0.13), transparent 60%), radial-gradient(1100px 800px at 50% 55%, rgba(14,14,16,0.6), transparent 75%)",
        }}
      />
      {showGate && (
        <EntryGate onGuest={continueAsGuest} onGoogle={doSignIn} authMsg={authMsg} />
      )}

      {/* top bar */}
      <header
        style={{
          position: "relative",
          zIndex: 1,
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
          <HermesMark size={30} idPrefix="hm-cmd-nav" />
          <span style={{ fontFamily: "var(--font-display)", fontSize: 19 }}>
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
          <button
            className="hc-press"
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
            Reset workspace
          </button>
        </div>
      </header>

      {/* unified pipeline strip: one agent, three sponsors, no toggle */}
      <PipelineStrip />

      <div
        className="hc-cmd-grid"
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 460px)",
          gap: 0,
          height: "calc(100vh - 63px - 46px)",
        }}
      >
        {/* OPERATIONS COLUMN */}
        <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <FleetPanel
            fleet={fleet}
            provisioning={provisioning}
            machineBusy={machineBusy}
            onProvision={provisionBody}
            onMachineAction={machineAction}
            onDestroy={destroyMachine}
          />

          <div
            ref={logRef}
            style={{ flex: 1, overflowY: "auto", padding: "20px clamp(16px, 3vw, 32px)" }}
          >
            {log.length === 0 && (
              <div style={{ maxWidth: 600, margin: "4vh auto 0", textAlign: "center" }}>
                <HermesMark size={64} idPrefix="hm-cmd-hero" style={{ opacity: 0.95 }} />
                <h2
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 400,
                    fontSize: 28,
                    margin: "16px 0 8px",
                  }}
                >
                  Give Hermes a business directive.
                </h2>
                <p style={{ color: "rgba(237,230,217,0.55)", fontSize: 15, marginBottom: 22 }}>
                  Hermes spins up its own machine, earns and spends real money, and pauses for your
                  approval whenever a dollar is on the line.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {PRESETS.map((p) => (
                    <button
                      className="hc-press"
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
                <DirectiveRow key={i} text={entry.text ?? ""} />
              ) : (
                <div key={i} style={{ margin: "4px 0 18px" }}>
                  {entry.events && <EventStream events={entry.events} />}
                  {entry.text && <ReportBlock text={entry.text} />}
                </div>
              ),
            )}
            {busy && (
              <div
                style={{
                  display: "flex",
                  gap: 7,
                  alignItems: "center",
                  margin: "14px 2px",
                  color: "rgba(237,230,217,0.5)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                }}
              >
                <Dot /> <Dot d={0.2} /> <Dot d={0.4} /> Hermes is operating.
              </div>
            )}
          </div>

          {/* directive composer */}
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
              placeholder="Issue a directive to Hermes."
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
              className="hc-press"
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              style={{
                background:
                  busy || !input.trim()
                    ? "rgba(237,230,217,0.12)"
                    : `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
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
              Dispatch
            </button>
          </div>
        </section>

        {/* TREASURY COLUMN */}
        <aside
          className="hc-cmd-aside"
          style={{
            borderLeft: "1px solid rgba(237,230,217,0.08)",
            background: "rgba(0,0,0,0.25)",
            overflowY: "auto",
            padding: "20px clamp(16px, 2vw, 24px)",
          }}
        >
          <JobDeskPanel
            jobs={jobs}
            services={services}
            stripeMode={state?.stripeMode ?? "none"}
            jobBusy={jobBusy}
            jobMsg={jobMsg}
            onQuote={quoteJob}
            onDeliver={deliverJob}
          />

          <div style={{ height: 24 }} />

          <TreasuryPanel
            state={state}
            pending={pending}
            deciding={deciding}
            onDecide={decide}
            onDeposit={deposit}
            depositing={depositing}
            depositMsg={depositMsg}
          />
        </aside>
      </div>
    </main>
  );
}

function jobStatusMeta(status: JobStatus): { label: string; color: string } {
  switch (status) {
    case "quoted":
      return { label: "QUOTED", color: WARN };
    case "paid":
      return { label: "PAID", color: BLUE };
    case "delivering":
      return { label: "DELIVERING", color: TEAL };
    case "delivered":
      return { label: "DELIVERED", color: SUCCESS };
    case "failed":
      return { label: "FAILED", color: DANGER };
    default:
      return { label: String(status).toUpperCase(), color: "rgba(237,230,217,0.6)" };
  }
}

function JobDeskPanel({
  jobs,
  services,
  stripeMode,
  jobBusy,
  jobMsg,
  onQuote,
  onDeliver,
}: {
  jobs: Job[];
  services: ServiceCatalogItem[];
  stripeMode: "none" | "test" | "live";
  jobBusy: string | null;
  jobMsg: string | null;
  onQuote: (input: { service: string; brief: string; priceUsd: number }) => void;
  onDeliver: (jobId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState("");
  const [brief, setBrief] = useState("");
  const [price, setPrice] = useState("");

  const canQuote = stripeMode !== "none";
  const quoting = jobBusy === "quote";

  // Effective selection falls back to the first service until the operator picks
  // one, derived in render so we never write state in an effect.
  const effectiveService = service || services[0]?.key || "";
  const selected = services.find((s) => s.key === effectiveService) ?? null;
  const effectivePrice =
    price !== "" ? price : selected ? String(selected.suggested_price_usd) : "";

  function pickService(key: string) {
    setService(key);
    const svc = services.find((s) => s.key === key);
    setPrice(svc ? String(svc.suggested_price_usd) : "");
  }

  function submit() {
    const priceUsd = Number(effectivePrice) || (selected?.suggested_price_usd ?? 0);
    if (!effectiveService || !brief.trim() || priceUsd <= 0) return;
    onQuote({ service: effectiveService, brief: brief.trim(), priceUsd });
    setBrief("");
    setOpen(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 20, margin: 0 }}>
          Job Desk
        </h3>
        <button
          className="hc-press"
          onClick={() => setOpen((v) => !v)}
          disabled={!canQuote}
          title={canQuote ? "" : "Connect Stripe to quote real jobs."}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 700,
            color: canQuote ? INK : "rgba(237,230,217,0.4)",
            background: canQuote ? `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})` : "rgba(237,230,217,0.12)",
            border: "none",
            borderRadius: 8,
            padding: "7px 13px",
            cursor: canQuote ? "pointer" : "default",
            whiteSpace: "nowrap",
          }}
        >
          {open ? "Close" : "New order"}
        </button>
      </div>

      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-body)",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "rgba(237,230,217,0.55)",
        }}
      >
        HermesCo sells real units of compute work. Quote a job, the customer pays the Stripe link,
        then Hermes runs it on a Fly machine and returns the deliverable. Profit = price minus
        compute.
      </p>

      {open && (
        <div
          style={{
            border: "1px solid rgba(224,163,90,0.3)",
            borderRadius: 12,
            padding: "14px 14px",
            background: "rgba(224,163,90,0.05)",
            display: "flex",
            flexDirection: "column",
            gap: 11,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", color: "rgba(237,230,217,0.5)" }}>
              SERVICE
            </span>
            <select
              value={effectiveService}
              onChange={(e) => pickService(e.target.value)}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: CREAM,
                background: INK,
                border: "1px solid rgba(237,230,217,0.18)",
                borderRadius: 8,
                padding: "9px 10px",
              }}
            >
              {services.length === 0 && <option value="">Loading services.</option>}
              {services.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name} (from {money(s.suggested_price_usd)})
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(237,230,217,0.55)", lineHeight: 1.5 }}>
              {selected.tagline}
              <div style={{ marginTop: 4, color: "rgba(237,230,217,0.4)" }}>
                Returns: {selected.deliverable}
              </div>
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", color: "rgba(237,230,217,0.5)" }}>
              {selected ? selected.brief.toUpperCase() : "BRIEF"}
            </span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder="The customer's task: a URL, a Git repo, or a command."
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: CREAM,
                background: INK,
                border: "1px solid rgba(237,230,217,0.18)",
                borderRadius: 8,
                padding: "9px 10px",
                resize: "vertical",
              }}
            />
          </label>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, width: 110 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", color: "rgba(237,230,217,0.5)" }}>
                PRICE USD
              </span>
              <input
                type="number"
                min={1}
                value={effectivePrice}
                onChange={(e) => setPrice(e.target.value)}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: CREAM,
                  background: INK,
                  border: "1px solid rgba(237,230,217,0.18)",
                  borderRadius: 8,
                  padding: "9px 10px",
                }}
              />
            </label>
            <button
              className="hc-press"
              onClick={submit}
              disabled={quoting || !brief.trim() || !effectiveService}
              style={{
                flex: 1,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 700,
                color: quoting || !brief.trim() ? "rgba(237,230,217,0.4)" : INK,
                background: quoting || !brief.trim() ? "rgba(237,230,217,0.12)" : `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
                border: "none",
                borderRadius: 8,
                padding: "10px 0",
                cursor: quoting || !brief.trim() ? "default" : "pointer",
              }}
            >
              {quoting ? "Quoting." : "Quote job"}
            </button>
          </div>
        </div>
      )}

      {jobMsg && (
        <div
          style={{
            border: "1px solid rgba(110,151,255,0.3)",
            borderRadius: 10,
            padding: "10px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(237,230,217,0.8)",
            lineHeight: 1.5,
            background: "rgba(110,151,255,0.05)",
          }}
        >
          {jobMsg}
        </div>
      )}

      {jobs.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(237,230,217,0.4)",
            lineHeight: 1.6,
            border: "1px dashed rgba(237,230,217,0.14)",
            borderRadius: 10,
            padding: "14px 14px",
          }}
        >
          No jobs on the order book yet.{" "}
          {canQuote ? 'Click "New order" to quote one, or give Hermes a directive.' : "Connect Stripe to start quoting jobs."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} busy={jobBusy === j.id} onDeliver={onDeliver} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  busy,
  onDeliver,
}: {
  job: Job;
  busy: boolean;
  onDeliver: (jobId: string) => void;
}) {
  const [showDeliverable, setShowDeliverable] = useState(false);
  const meta = jobStatusMeta(job.status);
  const net =
    job.status === "delivered" ? job.priceUsd - (job.computeCostUsd ?? 0) : null;

  return (
    <div
      style={{
        border: `1px solid ${meta.color}33`,
        borderRadius: 12,
        padding: "13px 14px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: CREAM }}>
          {job.serviceName}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: meta.color,
            border: `1px solid ${meta.color}55`,
            borderRadius: 999,
            padding: "2px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {meta.label}
        </span>
      </div>

      <div
        style={{
          marginTop: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "rgba(237,230,217,0.6)",
          lineHeight: 1.5,
          wordBreak: "break-word",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        title={job.brief}
      >
        {job.brief}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 9 }}>
        <Vital label="PRICE" value={money(job.priceUsd)} />
        {job.computeCostUsd != null && <Vital label="COMPUTE" value={money(job.computeCostUsd)} />}
        {net != null && <Vital label="NET PROFIT" value={money(net)} />}
        {job.customer && <Vital label="CUSTOMER" value={job.customer} />}
        {job.machineId && <Vital label="MACHINE" value={job.machineId} />}
      </div>

      {job.error && (
        <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: DANGER, lineHeight: 1.5 }}>
          {job.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
        {(job.status === "quoted" || job.status === "paid") && (
          <a
            className="hc-press"
            href={job.paymentLinkUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1,
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: TEAL,
              background: "transparent",
              border: `1px solid ${TEAL}55`,
              borderRadius: 7,
              padding: "7px 0",
              textDecoration: "none",
            }}
          >
            Pay link
          </a>
        )}
        {job.status !== "delivered" && (
          <CardBtn
            label={busy ? "Working." : job.status === "quoted" ? "Deliver" : "Retry deliver"}
            onClick={() => onDeliver(job.id)}
            disabled={busy}
            color={GOLD}
          />
        )}
        {job.deliverable && (
          <CardBtn
            label={showDeliverable ? "Hide" : "View output"}
            onClick={() => setShowDeliverable((v) => !v)}
            disabled={false}
            color={BLUE}
          />
        )}
      </div>

      {showDeliverable && job.deliverable && (
        <pre
          style={{
            marginTop: 10,
            marginBottom: 0,
            maxHeight: 220,
            overflow: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "rgba(237,230,217,0.85)",
            background: INK,
            border: "1px solid rgba(237,230,217,0.12)",
            borderRadius: 8,
            padding: "10px 12px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {job.deliverable}
        </pre>
      )}
    </div>
  );
}

function PipelineStrip() {
  const node = (color: string, vendor: string, role: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}`,
          flexShrink: 0,
        }}
      />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: CREAM, whiteSpace: "nowrap" }}>
        {vendor}
        <span style={{ color: "rgba(237,230,217,0.45)" }}> · {role}</span>
      </span>
    </div>
  );
  const arrow = (
    <span style={{ color: "rgba(237,230,217,0.3)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
      {"->"}
    </span>
  );
  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "11px clamp(16px, 3vw, 32px)",
        borderBottom: "1px solid rgba(237,230,217,0.08)",
        background: "rgba(255,255,255,0.015)",
      }}
    >
      {node(BLUE, "Hermes 4 405B", "decides")}
      {arrow}
      {node(NVIDIA, "NVIDIA Nemotron", "screens")}
      {arrow}
      {node(GOLD, "Stripe", "settles")}
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "rgba(237,230,217,0.4)",
          whiteSpace: "nowrap",
        }}
      >
        ONE AGENT · NEMOCLAW ALWAYS ON
      </span>
    </div>
  );
}

function FleetPanel({
  fleet,
  provisioning,
  machineBusy,
  onProvision,
  onMachineAction,
  onDestroy,
}: {
  fleet: FleetData;
  provisioning: boolean;
  machineBusy: Record<string, string>;
  onProvision: () => void;
  onMachineAction: (id: string, action: "suspend" | "start") => void;
  onDestroy: (id: string) => void;
}) {
  const live = fleet.machines.filter((m) => m.state !== "destroyed");
  const totalCompute = live.reduce((s, m) => s + m.computeCostUsd, 0);

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(237,230,217,0.08)",
        padding: "14px clamp(16px, 3vw, 32px)",
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: live.length || !fleet.configured ? 12 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              color: "rgba(237,230,217,0.55)",
            }}
          >
            AGENT FLEET
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: CREAM }}>
            {live.length} machine{live.length === 1 ? "" : "s"}
          </span>
          {live.length > 0 && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(237,230,217,0.4)" }}>
              compute {money(totalCompute)}
            </span>
          )}
        </div>
        {fleet.configured && (
          <button
            className="hc-press"
            onClick={onProvision}
            disabled={provisioning}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 700,
              color: provisioning ? "rgba(237,230,217,0.4)" : INK,
              background: provisioning ? "rgba(237,230,217,0.12)" : `linear-gradient(135deg, ${BLUE}, #3B57E6)`,
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: provisioning ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {provisioning ? "Spinning up." : "Spin up agent body"}
          </button>
        )}
      </div>

      {!fleet.configured ? (
        <div
          style={{
            border: "1px dashed rgba(110,151,255,0.35)",
            borderRadius: 10,
            padding: "12px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(237,230,217,0.6)",
            lineHeight: 1.6,
          }}
        >
          Fly is not connected. Set FLY_API_TOKEN to spin up dedicated agent machines.
          {fleet.spec && (
            <div style={{ marginTop: 6, color: "rgba(237,230,217,0.45)" }}>
              Body spec: {fleet.spec.cpus} {fleet.spec.cpuKind} vCPU · {Math.round(fleet.spec.memoryMb / 1024)} GB
              RAM · {fleet.spec.region} · suspends to $0 when idle
            </div>
          )}
        </div>
      ) : live.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(237,230,217,0.45)",
            lineHeight: 1.6,
          }}
        >
          No machines yet. Hermes provisions one automatically on its first real task, or spin one up
          now.
          {fleet.spec && (
            <span style={{ color: "rgba(237,230,217,0.35)" }}>
              {" "}
              Each body: {fleet.spec.cpus} {fleet.spec.cpuKind} vCPU · {Math.round(fleet.spec.memoryMb / 1024)} GB RAM ·{" "}
              {fleet.spec.region}.
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
          {live.map((m) => (
            <MachineCard
              key={m.id}
              m={m}
              busy={machineBusy[m.id]}
              onAction={onMachineAction}
              onDestroy={onDestroy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MachineCard({
  m,
  busy,
  onAction,
  onDestroy,
}: {
  m: AgentMachine;
  busy?: string;
  onAction: (id: string, action: "suspend" | "start") => void;
  onDestroy: (id: string) => void;
}) {
  const meta = stateMeta(m.state);
  const isRunning = m.state === "started";
  const canResume = m.state === "suspended" || m.state === "stopped";

  return (
    <div
      style={{
        flex: "0 0 auto",
        width: 244,
        border: `1px solid ${meta.color}33`,
        borderRadius: 12,
        padding: "13px 14px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: CREAM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {m.id}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: meta.color,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: meta.color,
              boxShadow: isRunning ? `0 0 7px ${meta.color}` : "none",
            }}
          />
          {meta.label}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 10 }}>
        <Vital label="REGION" value={m.region} />
        <Vital label="CPU" value={`${m.cpus}x ${m.cpuKind}`} />
        <Vital label="RAM" value={`${Math.round(m.memoryMb / 1024)} GB`} />
        <Vital label="UPTIME" value={fmtUptime(m.uptimeMs)} />
        <Vital label="COMPUTE" value={money(m.computeCostUsd)} />
      </div>

      {m.goal && (
        <div
          style={{
            marginTop: 9,
            fontFamily: "var(--font-body)",
            fontSize: 12,
            color: "rgba(237,230,217,0.55)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {m.goal}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 11 }}>
        {isRunning && (
          <CardBtn label={busy === "suspend" ? "." : "Suspend"} onClick={() => onAction(m.id, "suspend")} disabled={!!busy} color={TEAL} />
        )}
        {canResume && (
          <CardBtn label={busy === "start" ? "." : "Resume"} onClick={() => onAction(m.id, "start")} disabled={!!busy} color={SUCCESS} />
        )}
        <CardBtn label={busy === "destroy" ? "." : "Destroy"} onClick={() => onDestroy(m.id)} disabled={!!busy} color={DANGER} />
      </div>
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", color: "rgba(237,230,217,0.4)" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(237,230,217,0.85)", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function CardBtn({
  label,
  onClick,
  disabled,
  color,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  color: string;
}) {
  return (
    <button
      className="hc-press"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: disabled ? "rgba(237,230,217,0.35)" : color,
        background: "transparent",
        border: `1px solid ${disabled ? "rgba(237,230,217,0.12)" : `${color}55`}`,
        borderRadius: 7,
        padding: "6px 0",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DirectiveRow({ text }: { text: string }) {
  return (
    <div
      style={{
        margin: "18px 0 10px",
        borderLeft: `2px solid ${GOLD}`,
        paddingLeft: 14,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.16em",
          color: GOLD,
          marginBottom: 4,
        }}
      >
        DIRECTIVE
      </div>
      <div style={{ fontSize: 15, color: CREAM, lineHeight: 1.5, fontWeight: 500 }}>{text}</div>
    </div>
  );
}

function ReportBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 10,
        borderLeft: `2px solid rgba(110,151,255,0.6)`,
        paddingLeft: 14,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.16em",
          color: BLUE,
          marginBottom: 4,
        }}
      >
        HERMES REPORT
      </div>
      <div
        style={{
          fontSize: 14.5,
          lineHeight: 1.6,
          color: "rgba(237,230,217,0.92)",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
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
        <div style={{ display: "flex", justifyContent: "center" }}>
          <HermesMark size={56} idPrefix="hm-gate" />
        </div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: 26,
            margin: "16px 0 6px",
            color: CREAM,
          }}
        >
          Enter the Command Center
        </h2>
        <p style={{ color: "rgba(237,230,217,0.55)", fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
          Drive an autonomous business in real time. Continue as a guest to start instantly, or sign
          in to keep a named operator on your approval ledger.
        </p>
        <button
          className="hc-press"
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
          Continue as guest
        </button>
        <button
          className="hc-press"
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
          No card to enter. Every money move is policy-bounded.
        </p>
      </div>
    </div>
  );
}

function EventStream({ events }: { events: AgentEvent[] }) {
  const rows = events.filter((e) => e.kind !== "message");
  if (rows.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
      {rows.map((e, i) => (
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
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  };
  if (e.kind === "thought")
    return (
      <div style={{ ...base, fontStyle: "italic", color: "rgba(237,230,217,0.55)" }}>
        <span className="hc-tag">THINK</span>
        <span>{e.text}</span>
      </div>
    );
  if (e.kind === "tool_call")
    return (
      <div style={{ ...base, borderColor: "rgba(91,214,192,0.3)", color: TEAL }}>
        <span className="hc-tag">CALL</span>
        <span>
          {e.toolName}({fmtArgs(e.toolArgs)})
        </span>
      </div>
    );
  if (e.kind === "tool_result")
    return (
      <div style={{ ...base, color: "rgba(237,230,217,0.6)" }}>
        <span className="hc-tag">RESULT</span>
        <span>{truncate(e.text ?? "", 220)}</span>
      </div>
    );
  if (e.kind === "proposal")
    return (
      <div style={{ ...base, borderColor: "rgba(200,137,62,0.32)", color: GOLD }}>
        <span className="hc-tag">PROPOSE</span>
        <span>{e.text}</span>
      </div>
    );
  if (e.kind === "awaiting_approval")
    return (
      <div style={{ ...base, borderColor: "rgba(245,158,11,0.5)", color: WARN, fontWeight: 600 }}>
        <span className="hc-tag">HOLD</span>
        <span>Awaiting your approval in the Treasury.</span>
      </div>
    );
  if (e.kind === "error")
    return (
      <div style={{ ...base, color: DANGER }}>
        <span className="hc-tag">ERROR</span>
        <span>{e.text}</span>
      </div>
    );
  return null;
}

function TreasuryPanel({
  state,
  pending,
  deciding,
  onDecide,
  onDeposit,
  depositing,
  depositMsg,
}: {
  state: TreasuryState | null;
  pending: Proposal[];
  deciding: string | null;
  onDecide: (id: string, d: "approve" | "deny") => void;
  onDeposit: (amountUsd: number) => void;
  depositing: boolean;
  depositMsg: string | null;
}) {
  if (!state)
    return (
      <div style={{ color: "rgba(237,230,217,0.5)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
        Loading Treasury.
      </div>
    );

  const profitColor = state.netProfitUsd > 0 ? SUCCESS : state.netProfitUsd < 0 ? DANGER : CREAM;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 20, margin: 0 }}>
          Treasury
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.1em",
              color: state.backend === "convex" ? SUCCESS : "rgba(237,230,217,0.4)",
              border: `1px solid ${state.backend === "convex" ? "rgba(34,197,94,0.4)" : "rgba(237,230,217,0.18)"}`,
              borderRadius: 999,
              padding: "3px 9px",
            }}
            title={
              state.backend === "convex"
                ? "Durable Convex persistence: balances and ledger survive restarts and redeploys."
                : "In-memory fallback: state is not durable across redeploys."
            }
          >
            {state.backend === "convex" ? "PERSISTED: CONVEX" : "PERSIST: MEMORY"}
          </span>
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
        <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
          <Metric label="Deposited" value={money(state.depositsUsd)} color={GOLD} />
          <Metric label="Revenue" value={money(state.revenueUsd)} color={SUCCESS} />
          <Metric label="Spend" value={money(state.expenseUsd)} color="rgba(237,230,217,0.8)" />
          <Metric label="Net profit" value={money(state.netProfitUsd)} color={profitColor} />
        </div>
      </div>

      <DepositControl
        stripeMode={state.stripeMode}
        onDeposit={onDeposit}
        depositing={depositing}
        depositMsg={depositMsg}
      />

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
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: WARN, letterSpacing: "0.1em" }}>
            AWAITING APPROVAL ({pending.length})
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
                {"->"} {p.counterparty}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "rgba(237,230,217,0.5)", marginBottom: 12 }}>
                {p.safetyReason}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="hc-press"
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
                  className="hc-press"
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
          lineHeight: 1.8,
        }}
      >
        Hermes 4 · Nous Research &nbsp;·&nbsp; Nemotron · NVIDIA &nbsp;·&nbsp; Payments · Stripe
        <br />
        Compute · Fly.io &nbsp;·&nbsp; Persistence · Convex &nbsp;·&nbsp; Sandbox · Daytona
        <br />
        <a
          href="https://docs.hermesco.ai/credits"
          style={{ color: "rgba(237,230,217,0.4)", textDecoration: "underline" }}
        >
          Full credits
        </a>{" "}
        · Built with Cognition Devin
      </div>
    </div>
  );
}

function DepositControl({
  stripeMode,
  onDeposit,
  depositing,
  depositMsg,
}: {
  stripeMode: "test" | "live" | "none";
  onDeposit: (amountUsd: number) => void;
  depositing: boolean;
  depositMsg: string | null;
}) {
  const [custom, setCustom] = useState("");
  const presets = [25, 50, 100];
  const disabled = depositing || stripeMode === "none";

  return (
    <div style={{ border: "1px solid rgba(200,137,62,0.22)", borderRadius: 12, padding: "14px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(237,230,217,0.5)", letterSpacing: "0.1em" }}>
          FUND THE TREASURY
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: stripeMode === "live" ? GOLD : TEAL }}>
          {stripeMode === "live" ? "REAL MONEY" : stripeMode === "test" ? "STRIPE TEST" : "STRIPE OFF"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {presets.map((amt) => (
          <button
            className="hc-press"
            key={amt}
            onClick={() => onDeposit(amt)}
            disabled={disabled}
            style={{
              flex: 1,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 700,
              color: disabled ? "rgba(237,230,217,0.35)" : INK,
              background: disabled ? "rgba(237,230,217,0.08)" : `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
              border: "none",
              borderRadius: 8,
              padding: "10px 0",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            ${amt}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Custom $"
          inputMode="decimal"
          disabled={disabled}
          style={{
            flex: 1,
            background: SURFACE,
            border: "1px solid rgba(237,230,217,0.14)",
            borderRadius: 8,
            padding: "9px 12px",
            color: CREAM,
            fontSize: 13.5,
            fontFamily: "var(--font-mono)",
            outline: "none",
          }}
        />
        <button
          className="hc-press"
          onClick={() => {
            const amt = parseFloat(custom);
            if (Number.isFinite(amt) && amt >= 1) onDeposit(amt);
          }}
          disabled={disabled || !(parseFloat(custom) >= 1)}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 700,
            color: disabled || !(parseFloat(custom) >= 1) ? "rgba(237,230,217,0.35)" : INK,
            background: disabled || !(parseFloat(custom) >= 1) ? "rgba(237,230,217,0.08)" : CREAM,
            border: "none",
            borderRadius: 8,
            padding: "0 16px",
            cursor: disabled || !(parseFloat(custom) >= 1) ? "default" : "pointer",
          }}
        >
          {depositing ? "." : "Deposit"}
        </button>
      </div>
      {(depositMsg || stripeMode === "none") && (
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: stripeMode === "none" ? "rgba(237,230,217,0.4)" : TEAL, margin: "10px 0 0" }}>
          {depositMsg || "Connect Stripe to enable real deposits."}
        </p>
      )}
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
  return s.length > n ? s.slice(0, n) + "..." : s;
}
