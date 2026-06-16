import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Subscribe to messages in a conversation (real-time)
export const listMessages = query({
  args: { userId: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("userId", args.userId).eq("conversationId", args.conversationId)
      )
      .order("asc")
      .collect();
  },
});

// Get conversation list for sidebar
export const listConversations = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

// Get active run status (for typing indicator)
export const getRunStatus = query({
  args: { userId: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_user_conv", (q) =>
        q.eq("userId", args.userId).eq("conversationId", args.conversationId)
      )
      .order("desc")
      .first();
  },
});

// Add a message (called from API route via HTTP action)
export const addMessage = mutation({
  args: {
    userId: v.string(),
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    model: v.optional(v.string()),
    creditsUsed: v.optional(v.number()),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("chatMessages", args);

    // Upsert conversation entry
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("conversationId"), args.conversationId))
      .first();

    const title = args.role === "user" ? args.content.substring(0, 60) : undefined;

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastMessage: args.content.substring(0, 100),
        lastTs: args.ts,
        messageCount: (existing.messageCount || 0) + 1,
        ...(title && !existing.title ? { title } : {}),
      });
    } else {
      await ctx.db.insert("conversations", {
        userId: args.userId,
        conversationId: args.conversationId,
        title: title || "",
        lastMessage: args.content.substring(0, 100),
        lastTs: args.ts,
        messageCount: 1,
      });
    }
  },
});

// Set run status (thinking / tool_call / done)
export const setRunStatus = mutation({
  args: {
    userId: v.string(),
    conversationId: v.string(),
    status: v.union(
      v.literal("thinking"),
      v.literal("tool_call"),
      v.literal("done"),
      v.literal("error")
    ),
    toolName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentRuns")
      .withIndex("by_user_conv", (q) =>
        q.eq("userId", args.userId).eq("conversationId", args.conversationId)
      )
      .order("desc")
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        toolName: args.toolName,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("agentRuns", {
        userId: args.userId,
        conversationId: args.conversationId,
        status: args.status,
        toolName: args.toolName,
        startedAt: now,
        updatedAt: now,
      });
    }
  },
});

// Delete a conversation and its messages
export const deleteConversation = mutation({
  args: { userId: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("userId", args.userId).eq("conversationId", args.conversationId)
      )
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);

    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("conversationId"), args.conversationId))
      .first();
    if (conv) await ctx.db.delete(conv._id);
  },
});
