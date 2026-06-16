"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthProvider } from "@/contexts/AuthContext";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function Providers({ children }: { children: ReactNode }) {
  const inner = <AuthProvider>{children}</AuthProvider>;

  if (convex) {
    return <ConvexProvider client={convex}>{inner}</ConvexProvider>;
  }

  return inner;
}
