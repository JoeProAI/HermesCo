// HermesCo - persistence for the Treasury.
//
// Convex-backed when NEXT_PUBLIC_CONVEX_URL is set and reachable; otherwise (or
// on any Convex error) it transparently falls back to an in-process store so the
// demo always runs. Convex gives durable, real-time state across serverless
// invocations - the moment the deployment URL is set, writes persist and the
// command center can subscribe to live updates.

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { Budget, LedgerEntry, Proposal } from "./types";

interface MemWorkspace {
  budget: Budget | null;
  proposals: Map<string, Proposal>;
  ledger: LedgerEntry[];
}

const mem = new Map<string, MemWorkspace>();

const t = anyApi.treasury;

function hasConvex(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
}

// Starts enabled only if a deployment URL exists; any runtime error flips it off.
let convexEnabled = hasConvex();
let convexClient: ConvexHttpClient | null = null;

function client(): ConvexHttpClient {
  if (!convexClient) {
    convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
  }
  return convexClient;
}

function disableConvex(err: unknown): void {
  if (convexEnabled) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`HermesCo: Convex unavailable, using in-memory store. (${msg})`);
    convexEnabled = false;
  }
}

function memWs(id: string): MemWorkspace {
  let ws = mem.get(id);
  if (!ws) {
    ws = { budget: null, proposals: new Map(), ledger: [] };
    mem.set(id, ws);
  }
  return ws;
}

export function storageBackend(): "convex" | "memory" {
  return convexEnabled ? "convex" : "memory";
}

export async function getBudget(id: string): Promise<Budget | null> {
  if (convexEnabled) {
    try {
      return (await client().query(t.getBudget, { workspaceId: id })) as Budget | null;
    } catch (err) {
      disableConvex(err);
    }
  }
  return memWs(id).budget;
}

export async function setBudget(id: string, budget: Budget): Promise<void> {
  if (convexEnabled) {
    try {
      await client().mutation(t.setBudget, { workspaceId: id, budget });
      return;
    } catch (err) {
      disableConvex(err);
    }
  }
  memWs(id).budget = budget;
}

export async function listProposals(id: string): Promise<Proposal[]> {
  if (convexEnabled) {
    try {
      return (await client().query(t.listProposals, { workspaceId: id })) as Proposal[];
    } catch (err) {
      disableConvex(err);
    }
  }
  return Array.from(memWs(id).proposals.values());
}

export async function getProposal(id: string, pid: string): Promise<Proposal | null> {
  if (convexEnabled) {
    try {
      return (await client().query(t.getProposal, {
        workspaceId: id,
        proposalId: pid,
      })) as Proposal | null;
    } catch (err) {
      disableConvex(err);
    }
  }
  return memWs(id).proposals.get(pid) ?? null;
}

export async function putProposal(p: Proposal): Promise<void> {
  if (convexEnabled) {
    try {
      await client().mutation(t.putProposal, {
        workspaceId: p.workspaceId,
        proposalId: p.id,
        data: p,
      });
      return;
    } catch (err) {
      disableConvex(err);
    }
  }
  memWs(p.workspaceId).proposals.set(p.id, p);
}

export async function listLedger(id: string): Promise<LedgerEntry[]> {
  if (convexEnabled) {
    try {
      return (await client().query(t.listLedger, { workspaceId: id })) as LedgerEntry[];
    } catch (err) {
      disableConvex(err);
    }
  }
  return [...memWs(id).ledger];
}

export async function appendLedger(e: LedgerEntry): Promise<void> {
  if (convexEnabled) {
    try {
      await client().mutation(t.appendLedger, {
        workspaceId: e.workspaceId,
        entryId: e.id,
        data: e,
        ts: e.at,
      });
      return;
    } catch (err) {
      disableConvex(err);
    }
  }
  memWs(e.workspaceId).ledger.push(e);
}

export async function clearWorkspace(id: string): Promise<void> {
  if (convexEnabled) {
    try {
      await client().mutation(t.clearWorkspace, { workspaceId: id });
      return;
    } catch (err) {
      disableConvex(err);
    }
  }
  mem.delete(id);
}
