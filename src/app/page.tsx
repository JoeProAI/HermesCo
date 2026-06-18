"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import MessengerNetwork from "@/components/MessengerNetwork";
import HermesMark from "@/components/HermesMark";

const INK = "#0E0E10";
const GOLD = "#E0A35A";
const GOLD_DEEP = "#C8893E";
const CREAM = "#EDE6D9";
const TEAL = "#5BD6C0";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "rgba(237,230,217,0.72)",
        border: "1px solid rgba(237,230,217,0.14)",
        borderRadius: 999,
        padding: "6px 14px",
        background: "rgba(14,14,16,0.55)",
        backdropFilter: "blur(6px)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Pillar({
  index,
  tag,
  title,
  body,
  accent,
}: {
  index: number;
  tag: string;
  title: string;
  body: string;
  accent: string;
}) {
  return (
    <motion.div
      custom={index}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      style={{
        border: "1px solid rgba(237,230,217,0.10)",
        borderRadius: 14,
        padding: "28px 26px",
        background:
          "linear-gradient(180deg, rgba(20,20,23,0.72), rgba(14,14,16,0.55))",
        backdropFilter: "blur(8px)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${accent}, transparent)`,
        }}
      />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          letterSpacing: "0.14em",
          color: accent,
          marginBottom: 14,
        }}
      >
        {tag}
      </div>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          color: CREAM,
          margin: "0 0 10px",
          fontWeight: 400,
        }}
      >
        {title}
      </h3>
      <p style={{ color: "rgba(237,230,217,0.62)", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
        {body}
      </p>
    </motion.div>
  );
}

export default function Landing() {
  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: INK,
        color: CREAM,
        fontFamily: "var(--font-body)",
        overflowX: "hidden",
      }}
    >
      {/* Signature element: the Messenger Network (Hermes-bronze interactive constellation) */}
      <MessengerNetwork opacity={0.9} />

      {/* Warmth + legibility scrim over the network */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            "radial-gradient(1100px 720px at 76% 8%, rgba(200,137,62,0.16), transparent 60%), radial-gradient(820px 560px at 8% 92%, rgba(91,214,192,0.05), transparent 60%), radial-gradient(1200px 900px at 50% 42%, rgba(14,14,16,0.55), rgba(14,14,16,0.18) 55%, transparent 80%)",
        }}
      />

      {/* Film grain */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          opacity: 0.05,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* nav */}
      <nav
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px clamp(20px, 5vw, 64px)",
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HermesMark size={40} idPrefix="hm-nav" />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              letterSpacing: "0.01em",
            }}
          >
            Hermes<span style={{ color: GOLD }}>Co</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(14px, 3vw, 26px)" }}>
          <a
            href="https://docs.hermesco.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "rgba(237,230,217,0.82)",
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            Docs
          </a>
          <Link
            href="/command"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: INK,
              background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
              padding: "10px 18px",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Command Center →
          </Link>
        </div>
      </nav>

      {/* hero */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          padding: "clamp(40px, 8vw, 90px) clamp(20px, 5vw, 64px) 60px",
          display: "grid",
          gridTemplateColumns: "minmax(0,1.15fr) minmax(0,0.85fr)",
          gap: 48,
          alignItems: "center",
        }}
        className="hc-hero"
      >
        <div>
          <motion.div
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 26 }}
          >
            <Pill>NVIDIA Nemotron</Pill>
            <Pill>Nous Research · Hermes</Pill>
            <Pill>Stripe</Pill>
          </motion.div>

          <motion.h1
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 400,
              fontSize: "clamp(40px, 6vw, 74px)",
              lineHeight: 1.04,
              margin: "0 0 22px",
              letterSpacing: "-0.01em",
            }}
          >
            The autonomous business that{" "}
            <span
              style={{
                background: "var(--color-accent-gradient)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              can&apos;t lose money.
            </span>
          </motion.h1>

          <motion.p
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            style={{
              fontSize: 18,
              lineHeight: 1.65,
              color: "rgba(237,230,217,0.74)",
              maxWidth: 560,
              margin: "0 0 30px",
            }}
          >
            HermesCo is a one-agent company. Hermes earns revenue, spends on the tools it
            needs, and runs real operations, and every dollar is gated by a human-in-the-loop{" "}
            <strong style={{ color: CREAM, fontWeight: 600 }}>Treasury</strong> with hard caps it
            physically cannot breach.
          </motion.p>

          {/* live-status ribbon (terminal voice, no fabricated figures) */}
          <motion.div
            custom={3}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              letterSpacing: "0.04em",
              color: "rgba(237,230,217,0.6)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 30,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: TEAL,
                boxShadow: `0 0 10px ${TEAL}`,
                display: "inline-block",
              }}
            />
            TREASURY ARMED · PER-ACTION $50 · DAILY $100 · RESERVE $20 · enforced in code
          </motion.div>

          <motion.div
            custom={4}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            style={{ display: "flex", gap: 14, flexWrap: "wrap" }}
          >
            <Link
              href="/command"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                color: INK,
                background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
                padding: "14px 26px",
                borderRadius: 10,
                textDecoration: "none",
                fontWeight: 700,
                boxShadow: "0 0 40px rgba(200,137,62,0.28)",
              }}
            >
              Enter the Command Center
            </Link>
            <a
              href="#how"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                color: CREAM,
                border: "1px solid rgba(237,230,217,0.18)",
                padding: "14px 26px",
                borderRadius: 10,
                textDecoration: "none",
                background: "rgba(14,14,16,0.4)",
              }}
            >
              How it works
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: "relative", display: "flex", justifyContent: "center" }}
          className="hc-hero-emblem"
        >
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            style={{ position: "relative" }}
          >
            <div
              style={{
                position: "absolute",
                inset: "-14%",
                background: "radial-gradient(circle, rgba(200,137,62,0.34), transparent 65%)",
                filter: "blur(22px)",
              }}
            />
            <HermesMark
              size={420}
              idPrefix="hm-hero"
              title="HermesCo Messenger Seal"
              style={{ position: "relative", width: "min(420px, 70vw)", height: "auto" }}
            />
          </motion.div>
        </motion.div>
      </section>

      {/* pillars */}
      <section
        id="how"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          padding: "30px clamp(20px, 5vw, 64px) 20px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 18,
          }}
        >
          <Pillar
            index={0}
            tag="01 · EARN"
            accent={GOLD}
            title="It makes money"
            body="A customer brings a real task. Hermes quotes it with a Stripe payment link, runs the job on its own machine once paid, and returns the deliverable. Revenue lands on a live ledger."
          />
          <Pillar
            index={1}
            tag="02 · SPEND"
            accent={TEAL}
            title="Under your control"
            body="To buy the SaaS and APIs it needs, the agent files a proposal. Small, safe spends auto-approve; anything bigger waits for one human tap. Over-cap or prohibited moves are refused outright."
          />
          <Pillar
            index={2}
            tag="03 · SCALE · SAFE"
            accent="#8FB7F0"
            title="At any scale"
            body="Each agent runs on its own isolated Fly machine (a Daytona sandbox is the fallback), and every spend is screened by an NVIDIA Nemotron pass. A fleet of bounded, autonomous operators."
          />
        </div>
      </section>

      {/* money loop */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          padding: "60px clamp(20px, 5vw, 64px)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 400,
            margin: "0 0 8px",
          }}
        >
          The money loop, bounded by design
        </h2>
        <p style={{ color: "rgba(237,230,217,0.6)", margin: "0 0 36px", maxWidth: 620 }}>
          The guarantee isn&apos;t a promise in a prompt. It&apos;s enforced in code at execution time.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {[
            ["Propose", "The agent proposes every money move (earn or spend) with amount, vendor, and purpose."],
            ["Screen", "NemoClaw (NVIDIA Nemotron) + deterministic rules classify it: safe, needs-review, or blocked."],
            ["Decide", "Small safe spends auto-clear. Bigger ones pause for a human tap. Prohibited ones are refused."],
            ["Execute", "Stripe moves the money, then hard caps (per-action, daily, reserve) are re-checked. It can never overspend."],
          ].map(([t, b], i) => (
            <motion.div
              key={t}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              style={{
                border: "1px solid rgba(237,230,217,0.10)",
                borderRadius: 12,
                padding: "22px 20px",
                background: "rgba(20,20,23,0.6)",
                backdropFilter: "blur(8px)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: GOLD,
                  marginBottom: 10,
                }}
              >
                0{i + 1}
              </div>
              <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 8 }}>{t}</div>
              <p style={{ color: "rgba(237,230,217,0.6)", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                {b}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* guarantee band (intentional full-bleed grid break) */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1100,
          margin: "0 auto 40px",
          padding: "0 clamp(20px, 5vw, 64px)",
        }}
      >
        <div
          style={{
            border: "1px solid rgba(200,137,62,0.32)",
            borderRadius: 16,
            padding: "36px 32px",
            textAlign: "center",
            background:
              "linear-gradient(180deg, rgba(200,137,62,0.10), rgba(200,137,62,0.02))",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.16em",
              color: GOLD,
              marginBottom: 12,
            }}
          >
            THE VIABILITY STORY
          </div>
          <p
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(22px, 3vw, 34px)",
              lineHeight: 1.3,
              margin: "0 auto",
              maxWidth: 760,
            }}
          >
            An autonomous agent you can actually trust with a credit card, because the human
            holds the caps, and the caps are absolute.
          </p>
        </div>
      </section>

      {/* docs band */}
      <section
        id="docs"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          padding: "10px clamp(20px, 5vw, 64px) 70px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 26,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.16em",
                color: GOLD,
                marginBottom: 12,
              }}
            >
              DOCUMENTATION
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(26px, 4vw, 42px)",
                fontWeight: 400,
                margin: 0,
                maxWidth: 620,
                lineHeight: 1.1,
              }}
            >
              Read how it works, then build on it
            </h2>
          </div>
          <a
            href="https://docs.hermesco.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: TEAL,
              border: "1px solid rgba(91,214,192,0.34)",
              padding: "12px 20px",
              borderRadius: 10,
              textDecoration: "none",
              background: "rgba(91,214,192,0.06)",
              whiteSpace: "nowrap",
            }}
          >
            Open the docs →
          </a>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(232px, 1fr))",
            gap: 16,
          }}
        >
          {[
            ["Quickstart", "Run a job end to end in about 60 seconds with the Stripe test card.", "https://docs.hermesco.ai/quickstart", GOLD],
            ["Architecture", "How decide, screen, settle, and the Treasury fit together.", "https://docs.hermesco.ai/architecture", TEAL],
            ["Treasury & safety", "The hard caps and the NVIDIA Nemotron screen, explained.", "https://docs.hermesco.ai/concepts/safety", "#8FB7F0"],
            ["API reference", "Drive the agent and Treasury directly over HTTP.", "https://docs.hermesco.ai/api-reference/introduction", GOLD],
          ].map(([t, b, href, accent], i) => (
            <motion.a
              key={t}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              whileHover={{ y: -4 }}
              style={{
                position: "relative",
                overflow: "hidden",
                border: "1px solid rgba(237,230,217,0.10)",
                borderRadius: 14,
                padding: "24px 22px",
                background:
                  "linear-gradient(180deg, rgba(20,20,23,0.72), rgba(14,14,16,0.55))",
                backdropFilter: "blur(8px)",
                textDecoration: "none",
                display: "block",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, ${accent}, transparent)`,
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: CREAM }}>
                  {t}
                </span>
                <span style={{ color: accent, fontFamily: "var(--font-mono)", fontSize: 15 }}>→</span>
              </div>
              <p
                style={{
                  color: "rgba(237,230,217,0.62)",
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {b}
              </p>
            </motion.a>
          ))}
        </div>
      </section>

      {/* footer / credits */}
      <footer
        style={{
          position: "relative",
          zIndex: 1,
          borderTop: "1px solid rgba(237,230,217,0.08)",
          padding: "30px clamp(20px, 5vw, 64px) 80px",
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HermesMark size={26} idPrefix="hm-foot" />
          <span style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>
            Hermes<span style={{ color: GOLD }}>Co</span>
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(237,230,217,0.5)",
            textAlign: "right",
            lineHeight: 1.9,
          }}
        >
          Hermes 4 by Nous Research · Nemotron by NVIDIA · Payments by Stripe
          <br />
          Compute by Fly.io · Persistence by Convex · Sandbox by Daytona
          <br />
          <a
            href="https://docs.hermesco.ai/credits"
            style={{ color: "rgba(237,230,217,0.5)", textDecoration: "underline" }}
          >
            Full credits
          </a>{" "}
          · Built with Cognition Devin
        </div>
      </footer>
    </main>
  );
}
