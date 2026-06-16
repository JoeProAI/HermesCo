import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// List all invites — live, updates in real time
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("invites")
      .order("desc")
      .collect();
  },
});

// List by status
export const listByStatus = query({
  args: { status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invites")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});

// Request access — called from the landing page form
export const requestAccess = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase().trim();

    // Check if already exists
    const existing = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) {
      return { status: existing.status, alreadyExists: true };
    }

    await ctx.db.insert("invites", {
      email,
      status: "pending",
      requestedAt: Date.now(),
    });

    return { status: "pending", alreadyExists: false };
  },
});

// Approve — Joe uses this from the /access page
export const approve = mutation({
  args: { id: v.id("invites") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "approved",
      reviewedAt: Date.now(),
    });
  },
});

// Deny
export const deny = mutation({
  args: { id: v.id("invites"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "denied",
      reviewedAt: Date.now(),
      note: args.note,
    });
  },
});

// Check if an email is approved — used in signup gate
export const checkApproval = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase().trim()))
      .first();

    return {
      approved: invite?.status === "approved",
      status: invite?.status ?? "not_found",
    };
  },
});
