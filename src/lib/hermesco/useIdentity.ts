"use client";

// HermesCo identity - guest-first, with an optional Google sign-in.
//
// Guests get a stable, per-browser workspace so anyone (e.g. a judge) can drive
// the agent and Treasury immediately with zero login. Signing in with Google
// gives a persistent, named operator whose name is stamped on every approval in
// the ledger - the "real product" angle - without ever gating the demo.

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

const GUEST_KEY = "hermesco-guest-id";

export type IdentityKind = "guest" | "user";

export interface Identity {
  ready: boolean;
  kind: IdentityKind;
  workspaceId: string;
  name: string;
  email: string | null;
  photoURL: string | null;
  signInGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

function guestId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(GUEST_KEY);
  if (!id) {
    const rand =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    id = rand;
    window.localStorage.setItem(GUEST_KEY, id);
  }
  return id;
}

export function useIdentity(): Identity {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [guest] = useState<string>(() => guestId());

  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setReady(true);
      },
      () => setReady(true),
    );
    return () => unsub();
  }, []);

  const signInGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        return { ok: false };
      }
      const msg =
        code === "auth/operation-not-allowed"
          ? "Google sign-in isn't enabled for this project yet."
          : err instanceof Error
            ? err.message
            : String(err);
      return { ok: false, error: msg };
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  return useMemo<Identity>(() => {
    if (user) {
      return {
        ready,
        kind: "user",
        workspaceId: `u_${user.uid}`,
        name: user.displayName || user.email || "Operator",
        email: user.email,
        photoURL: user.photoURL,
        signInGoogle,
        signOut,
      };
    }
    return {
      ready,
      kind: "guest",
      workspaceId: `g_${guest}`,
      name: "Guest operator",
      email: null,
      photoURL: null,
      signInGoogle,
      signOut,
    };
  }, [user, ready, guest, signInGoogle, signOut]);
}
