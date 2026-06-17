"use client";

import { useEffect, useRef } from "react";

/**
 * The Messenger Network — HermesCo signature element.
 *
 * A living constellation of gold→bronze "messenger" nodes drifting over ink.
 * Connections ignite along the path nearest the cursor, as if Hermes' web of
 * messages is alive behind the terminal. A Hermes-bronze reimagining of the
 * joepro.ai interactive neural network (rhyme-protocol/NeuralNetworkInteractive).
 *
 * Honors prefers-reduced-motion (renders a single static frame, no loop) and
 * lazily initializes on the client only. Draws transparent so page ink + bronze
 * glows show through. pointer-events: none — never blocks the UI beneath it.
 */

type Palette = { core: string; glow: string };

// Bronze spectrum + cream highlight + rare teal "messenger" accent.
const NODE_PALETTE: Palette[] = [
  { core: "#E8B570", glow: "rgba(232,181,112" }, // gold light
  { core: "#E0A35A", glow: "rgba(224,163,90" }, // gold
  { core: "#C8893E", glow: "rgba(200,137,62" }, // bronze
  { core: "#B87333", glow: "rgba(184,115,51" }, // deep bronze
  { core: "#EDE6D9", glow: "rgba(237,230,217" }, // cream (rare)
  { core: "#5BD6C0", glow: "rgba(91,214,192" }, // teal messenger (rare)
];

// Weighted pick: bronze dominates, cream/teal are rare punctuation.
const PALETTE_WEIGHTS = [22, 26, 24, 18, 6, 4];

function pickPalette(): Palette {
  const total = PALETTE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < NODE_PALETTE.length; i++) {
    r -= PALETTE_WEIGHTS[i];
    if (r <= 0) return NODE_PALETTE[i];
  }
  return NODE_PALETTE[2];
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pal: Palette;
}

interface Attractor {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  strength: number;
}

export default function MessengerNetwork({
  density = 0.00009,
  maxNodes = 150,
  connectionDistance = 132,
  opacity = 1,
  interactive = true,
  dim = false,
}: {
  /** nodes per square pixel (auto-scales to viewport) */
  density?: number;
  maxNodes?: number;
  connectionDistance?: number;
  opacity?: number;
  interactive?: boolean;
  /** slower drift + lower line opacity for use behind dense UI */
  dim?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -9999,
    y: -9999,
    active: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const nodes: Node[] = [];
    const attractors: Attractor[] = [];
    const driftScale = dim ? 0.55 : 1;
    const lineAlpha = dim ? 0.55 : 1;

    const seed = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(maxNodes, Math.round(width * height * density));
      nodes.length = 0;
      for (let i = 0; i < target; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3 * driftScale,
          vy: (Math.random() - 0.5) * 0.3 * driftScale,
          radius: Math.random() * 1.5 + 0.8,
          pal: pickPalette(),
        });
      }

      attractors.length = 0;
      const attractorCount = 5;
      for (let i = 0; i < attractorCount; i++) {
        attractors.push({
          x: Math.random() * width,
          y: Math.random() * height,
          targetX: Math.random() * width,
          targetY: Math.random() * height,
          strength: Math.random() * 0.5 + 0.3,
        });
      }
    };

    seed();

    const distanceToSegment = (
      px: number,
      py: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number
    ) => {
      const A = px - x1;
      const B = py - y1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      let xx: number;
      let yy: number;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      const dx = px - xx;
      const dy = py - yy;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const draw = (animate: boolean) => {
      ctx.clearRect(0, 0, width, height);
      const m = mouseRef.current;

      if (animate) {
        attractors.forEach((a) => {
          const dx = a.targetX - a.x;
          const dy = a.targetY - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          a.x += dx * 0.001;
          a.y += dy * 0.001;
          if (dist < 50) {
            a.targetX = Math.random() * width;
            a.targetY = Math.random() * height;
          }
        });
      }

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        if (animate) {
          attractors.forEach((a) => {
            const dx = a.x - node.x;
            const dy = a.y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 300 && dist > 10) {
              const force = a.strength / (dist * 0.1);
              node.vx += (dx / dist) * force * 0.01 * driftScale;
              node.vy += (dy / dist) * force * 0.01 * driftScale;
            }
          });
          node.vx *= 0.99;
          node.vy *= 0.99;
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 0) node.x = width;
          if (node.x > width) node.x = 0;
          if (node.y < 0) node.y = height;
          if (node.y > height) node.y = 0;

          if (interactive && m.active) {
            const dx = m.x - node.x;
            const dy = m.y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 120) {
              const force = (120 - dist) / 120;
              node.x += dx * force * 0.02;
              node.y += dy * force * 0.02;
            }
          }
        }

        // Connections to nearby nodes.
        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j];
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < connectionDistance) {
            const base = (1 - distance / connectionDistance) * 0.4 * lineAlpha;
            let glowMul = 1;
            if (interactive && m.active) {
              const md = distanceToSegment(m.x, m.y, node.x, node.y, other.x, other.y);
              glowMul = md < 60 ? 1.8 : 1;
            }
            const o = Math.min(base * glowMul, 0.9);
            const grad = ctx.createLinearGradient(node.x, node.y, other.x, other.y);
            grad.addColorStop(0, `${node.pal.glow}, ${o})`);
            grad.addColorStop(1, `${other.pal.glow}, ${o})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = glowMul > 1 ? 0.7 : 0.3;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        }

        // Node body with mouse-proximity bloom.
        let scale = 1;
        let glowSize = 5;
        if (interactive && m.active) {
          const md = Math.sqrt((m.x - node.x) ** 2 + (m.y - node.y) ** 2);
          if (md < 90) {
            scale = 1 + (90 - md) / 90;
            glowSize = 12;
          }
        }

        const haloR = node.radius * scale * 4;
        const halo = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, haloR);
        halo.addColorStop(0, `${node.pal.glow}, 0.65)`);
        halo.addColorStop(0.5, `${node.pal.glow}, 0.28)`);
        halo.addColorStop(1, `${node.pal.glow}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = node.pal.core;
        ctx.shadowBlur = glowSize;
        ctx.shadowColor = node.pal.core;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    let raf = 0;
    const loop = () => {
      draw(true);
      raf = requestAnimationFrame(loop);
    };

    if (reduceMotion) {
      draw(false); // single static frame
    } else {
      loop();
    }

    const onResize = () => {
      seed();
      if (reduceMotion) draw(false);
    };
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
    };
    const onMouseLeave = () => {
      mouseRef.current.active = false;
    };

    window.addEventListener("resize", onResize);
    if (interactive && !reduceMotion) {
      window.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseleave", onMouseLeave);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [density, maxNodes, connectionDistance, interactive, dim]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity,
      }}
    />
  );
}
