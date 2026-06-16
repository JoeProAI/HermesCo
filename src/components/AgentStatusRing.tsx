"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "running" | "error";
type Size = "sm" | "md" | "lg";

interface AgentStatusRingProps {
  status: Status;
  size?: Size;
}

const sizeMap = {
  sm: { outer: 32, inner: 24, stroke: 2 },
  md: { outer: 48, inner: 36, stroke: 3 },
  lg: { outer: 72, inner: 56, stroke: 4 },
};

const statusColors = {
  idle: "var(--color-agent-idle)",
  running: "var(--color-agent-running)",
  error: "var(--color-agent-error)",
};

export function AgentStatusRing({ status, size = "md" }: AgentStatusRingProps) {
  const [rotation, setRotation] = useState(0);
  const dimensions = sizeMap[size];
  const color = statusColors[status];
  const radius = (dimensions.outer - dimensions.stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    if (status === "running") {
      const interval = setInterval(() => {
        setRotation((r) => (r + 2) % 360);
      }, 16);
      return () => clearInterval(interval);
    }
  }, [status]);

  return (
    <div 
      className="relative flex items-center justify-center"
      style={{ width: dimensions.outer, height: dimensions.outer }}
    >
      <svg
        width={dimensions.outer}
        height={dimensions.outer}
        className="absolute"
        style={{ 
          transform: status === "running" ? `rotate(${rotation}deg)` : "rotate(0deg)",
          transition: status !== "running" ? "transform 0.3s ease" : "none"
        }}
      >
        <circle
          cx={dimensions.outer / 2}
          cy={dimensions.outer / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={dimensions.stroke}
        />
        <circle
          cx={dimensions.outer / 2}
          cy={dimensions.outer / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={dimensions.stroke}
          strokeLinecap="round"
          strokeDasharray={status === "running" 
            ? `${circumference * 0.25} ${circumference * 0.75}`
            : `${circumference * 0.7} ${circumference * 0.3}`
          }
          style={{
            filter: `drop-shadow(0 0 ${dimensions.stroke * 2}px ${color})`,
            transition: "stroke-dasharray 0.5s ease"
          }}
        />
      </svg>
      
      {status === "running" && (
        <svg
          width={dimensions.outer}
          height={dimensions.outer}
          className="absolute animate-pulse-ring"
        >
          <circle
            cx={dimensions.outer / 2}
            cy={dimensions.outer / 2}
            r={radius + 4}
            fill="none"
            stroke={color}
            strokeWidth={1}
            opacity={0.3}
          />
        </svg>
      )}
      
      <div 
        className="rounded-full"
        style={{ 
          width: dimensions.inner, 
          height: dimensions.inner,
          background: "var(--color-surface)",
          boxShadow: `inset 0 2px 4px rgba(0,0,0,0.3), 0 0 ${dimensions.stroke * 3}px ${color}40`
        }}
      />
    </div>
  );
}
