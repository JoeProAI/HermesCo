import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// HermesCo Treasury persistence. Budget / Proposal / LedgerEntry are stored as
// opaque objects (the TS types in src/lib/hermesco own the shape); these
// functions just provide durable, real-time-subscribable storage per workspace.

export const getBudget = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const row = await ctx.db
      .query("treasuryBudgets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    return row?.budget ?? null;
  },
});

export const setBudget = mutation({
  args: { workspaceId: v.string(), budget: v.any() },
  handler: async (ctx, { workspaceId, budget }) => {
    const row = await ctx.db
      .query("treasuryBudgets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (row) await ctx.db.patch(row._id, { budget, updatedAt: Date.now() });
    else await ctx.db.insert("treasuryBudgets", { workspaceId, budget, updatedAt: Date.now() });
  },
});

export const listProposals = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db
      .query("treasuryProposals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("asc")
      .collect();
    return rows.map((r) => r.data);
  },
});

export const getProposal = query({
  args: { workspaceId: v.string(), proposalId: v.string() },
  handler: async (ctx, { workspaceId, proposalId }) => {
    const row = await ctx.db
      .query("treasuryProposals")
      .withIndex("by_proposal", (q) =>
        q.eq("workspaceId", workspaceId).eq("proposalId", proposalId),
      )
      .first();
    return row?.data ?? null;
  },
});

export const putProposal = mutation({
  args: { workspaceId: v.string(), proposalId: v.string(), data: v.any() },
  handler: async (ctx, { workspaceId, proposalId, data }) => {
    const row = await ctx.db
      .query("treasuryProposals")
      .withIndex("by_proposal", (q) =>
        q.eq("workspaceId", workspaceId).eq("proposalId", proposalId),
      )
      .first();
    if (row) await ctx.db.patch(row._id, { data });
    else await ctx.db.insert("treasuryProposals", { workspaceId, proposalId, data });
  },
});

export const listLedger = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db
      .query("treasuryLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("asc")
      .collect();
    return rows.map((r) => r.data);
  },
});

export const appendLedger = mutation({
  args: { workspaceId: v.string(), entryId: v.string(), data: v.any(), ts: v.number() },
  handler: async (ctx, { workspaceId, entryId, data, ts }) => {
    await ctx.db.insert("treasuryLedger", { workspaceId, entryId, data, ts });
  },
});

export const clearWorkspace = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const proposals = await ctx.db
      .query("treasuryProposals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const r of proposals) await ctx.db.delete(r._id);

    const ledger = await ctx.db
      .query("treasuryLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const r of ledger) await ctx.db.delete(r._id);

    const budget = await ctx.db
      .query("treasuryBudgets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (budget) await ctx.db.delete(budget._id);
  },
});
