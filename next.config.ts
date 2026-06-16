import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // P0 FIX: Do NOT expose API keys to client bundle.
  // All LLM calls go through /api/proxy which reads keys from server-side env.
  env: {},

  // ── Security headers ────────────────────────────────────────────────────────
  // Note: www → clawd.run redirect is handled exclusively in proxy.ts
  // (308, preserves Authorization headers for agent API calls).
  // Do NOT add a redirects() here — dual redirect layers cause loops.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          // Agents calling from external machines (Jobeous_II etc.)
          { key: "Access-Control-Allow-Origin",  value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
