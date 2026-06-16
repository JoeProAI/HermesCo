"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";

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
        background: "rgba(237,230,217,0.03)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Pillar({
  tag,
  title,
  body,
  accent,
}: {
  tag: string;
  title: string;
  body: string;
  accent: string;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(237,230,217,0.10)",
        borderRadius: 14,
        padding: "28px 26px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0))",
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
          fontFamily: "var(--font-editorial-serif)",
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
    </div>
  );
}

export default function Landing() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: INK,
        color: CREAM,
        fontFamily: "var(--font-body)",
        overflowX: "hidden",
      }}
    >
      {/* ambient glow */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(900px 600px at 78% 12%, rgba(200,137,62,0.16), transparent 60%), radial-gradient(700px 500px at 10% 90%, rgba(91,214,192,0.06), transparent 60%)",
          zIndex: 0,
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
          <Image src="/hermes-emblem.png" alt="HermesCo" width={40} height={40} priority />
          <span
            style={{
              fontFamily: "var(--font-editorial-serif)",
              fontSize: 22,
              letterSpacing: "0.02em",
            }}
          >
            Hermes<span style={{ color: GOLD }}>Co</span>
          </span>
        </div>
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
              fontFamily: "var(--font-editorial-serif)",
              fontWeight: 400,
              fontSize: "clamp(40px, 6vw, 72px)",
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
              color: "rgba(237,230,217,0.70)",
              maxWidth: 560,
              margin: "0 0 34px",
            }}
          >
            HermesCo is a one-agent company. Hermes earns revenue, spends on the tools it
            needs, and runs real operations — and every dollar is gated by a human-in-the-loop{" "}
            <strong style={{ color: CREAM, fontWeight: 600 }}>Treasury</strong> with hard caps it
            physically cannot breach.
          </motion.p>

          <motion.div
            custom={3}
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
        >
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            style={{ position: "relative" }}
          >
            <div
              style={{
                position: "absolute",
                inset: "-12%",
                background: "radial-gradient(circle, rgba(200,137,62,0.30), transparent 65%)",
                filter: "blur(20px)",
              }}
            />
            <Image
              src="/hermes-emblem.png"
              alt="HermesCo caduceus emblem"
              width={420}
              height={420}
              priority
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
            tag="01 · EARN"
            accent={GOLD}
            title="It makes money"
            body="Hermes stands up a real offer — a Stripe product, price, and payment link — and collects customer payments for delivered work. Revenue lands on a live ledger."
          />
          <Pillar
            tag="02 · SPEND"
            accent={TEAL}
            title="Under your control"
            body="To buy the SaaS and APIs it needs, the agent files a proposal. Small, safe spends auto-approve; anything bigger waits for one human tap. Over-cap or prohibited moves are refused outright."
          />
          <Pillar
            tag="03 · SCALE · SAFE"
            accent="#9A8CFF"
            title="At any scale"
            body="Each agent runs on its own isolated Fly machine with a Daytona sandbox for real work, screened by an NVIDIA Nemotron safety pass — a fleet of bounded, autonomous operators."
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
            fontFamily: "var(--font-editorial-serif)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 400,
            margin: "0 0 8px",
          }}
        >
          The money loop, bounded by design
        </h2>
        <p style={{ color: "rgba(237,230,217,0.6)", margin: "0 0 36px", maxWidth: 620 }}>
          The guarantee isn&apos;t a promise in a prompt — it&apos;s enforced in code at execution time.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {[
            ["Propose", "The agent proposes every money move — earn or spend — with amount, vendor, and purpose."],
            ["Screen", "NemoClaw (NVIDIA Nemotron) + deterministic rules classify it: safe, needs-review, or blocked."],
            ["Decide", "Small safe spends auto-clear. Bigger ones pause for a human tap. Prohibited ones are refused."],
            ["Execute", "Stripe moves the money — then hard caps (per-action, daily, reserve) are re-checked. It can never overspend."],
          ].map(([t, b], i) => (
            <div
              key={t}
              style={{
                border: "1px solid rgba(237,230,217,0.10)",
                borderRadius: 12,
                padding: "22px 20px",
                background: "rgba(255,255,255,0.02)",
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
            </div>
          ))}
        </div>
      </section>

      {/* guarantee band */}
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
              "linear-gradient(180deg, rgba(200,137,62,0.08), rgba(200,137,62,0.02))",
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
              fontFamily: "var(--font-editorial-serif)",
              fontSize: "clamp(22px, 3vw, 34px)",
              lineHeight: 1.3,
              margin: "0 auto",
              maxWidth: 760,
            }}
          >
            An autonomous agent you can actually trust with a credit card — because the human
            holds the caps, and the caps are absolute.
          </p>
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
          <Image src="/hermes-emblem.png" alt="HermesCo" width={26} height={26} />
          <span style={{ fontFamily: "var(--font-editorial-serif)", fontSize: 16 }}>
            Hermes<span style={{ color: GOLD }}>Co</span>
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(237,230,217,0.5)",
            textAlign: "right",
            lineHeight: 1.8,
          }}
        >
          Hermes by Nous Research · Nemotron by NVIDIA · Payments by Stripe
          <br />
          Engine: Cognition AI · Devin
        </div>
      </footer>
    </main>
  );
}
