import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  invites: defineTable({
    email: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied")
    ),
    requestedAt: v.number(),
    reviewedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_status", ["status"]),

  // Real-time chat messages per user conversation
  chatMessages: defineTable({
    userId: v.string(),
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    model: v.optional(v.string()),
    creditsUsed: v.optional(v.number()),
    ts: v.number(),
  }).index("by_conversation", ["userId", "conversationId"])
    .index("by_user", ["userId"]),

  // Active agent run status (real-time typing/tool indicators)
  agentRuns: defineTable({
    userId: v.string(),
    conversationId: v.string(),
    status: v.union(
      v.literal("thinking"),
      v.literal("tool_call"),
      v.literal("done"),
      v.literal("error")
    ),
    toolName: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_conv", ["userId", "conversationId"]),

  // Per-user conversation list (sidebar)
  conversations: defineTable({
    userId: v.string(),
    conversationId: v.string(),
    title: v.optional(v.string()),
    lastMessage: v.optional(v.string()),
    lastTs: v.number(),
    messageCount: v.number(),
  }).index("by_user", ["userId"]),

  // HermesCo Treasury — per-workspace budget, proposals, and ledger.
  // The full Proposal / LedgerEntry / Budget shapes are stored as opaque
  // objects so the TS domain types stay the single source of truth.
  treasuryBudgets: defineTable({
    workspaceId: v.string(),
    budget: v.any(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  treasuryProposals: defineTable({
    workspaceId: v.string(),
    proposalId: v.string(),
    data: v.any(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_proposal", ["workspaceId", "proposalId"]),

  treasuryLedger: defineTable({
    workspaceId: v.string(),
    entryId: v.string(),
    data: v.any(),
    ts: v.number(),
  }).index("by_workspace", ["workspaceId"]),
});
