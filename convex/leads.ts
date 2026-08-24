import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { arbostarGet } from "./gateway";

/**
 * ArboStar lead mirror.
 *
 * A lead carries the source recorded at intake, which is the attribution
 * rule for the Marketing screen: first contact, not every touch. The
 * endpoint returns newest first and ignores date filters, so the walk runs
 * forward from offset zero and stops once it is past the history window.
 */

const PAGE_SIZE = 100;
const HISTORY_DAYS = 800;
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 20000;

function cutoffDate(): string {
  return new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
}

function dateOnly(value: unknown): string {
  if (typeof value !== "string" || value.length < 10) return "";
  return value.slice(0, 10);
}

export const syncLeadsPage = internalAction({
  args: {
    offset: v.optional(v.number()),
    attempt: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("full"), v.literal("recent"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const offset = args.offset ?? 0;
    const attempt = args.attempt ?? 0;
    // A scheduled refresh only needs the newest leads. The full walk is for
    // the first load and for backfills.
    const mode = args.mode ?? "recent";
    const pageLimit = mode === "full" ? 400 : 4;
    try {
      const page = await arbostarGet("/api/v1/leads", {
        limit: PAGE_SIZE,
        offset,
      });
      const rows = (page.data ?? []) as Record<string, any>[];

      const leads = rows.map(row => {
        const address = (row.address ?? {}) as Record<string, any>;
        const client = (row.client ?? {}) as Record<string, any>;
        const reference = (row.reference ?? {}) as Record<string, any>;
        return {
          arboId: Number(row.id),
          number: String(row.number ?? ""),
          createdAt: dateOnly(row.created_at),
          source: reference.name ? String(reference.name) : "Not recorded",
          sourceId: reference.id === undefined ? undefined : Number(reference.id),
          statusName: String(row.status?.name ?? ""),
          clientId: client.id === undefined ? undefined : Number(client.id),
          clientName: client.name ? String(client.name) : undefined,
          city: address.city ? String(address.city) : undefined,
        };
      });

      await ctx.runMutation(internal.leads.upsertLeads, { leads });

      const dates = leads.map(lead => lead.createdAt).filter(Boolean).sort();
      const oldestOnPage = dates[0];
      const reachedCutoff =
        oldestOnPage !== undefined && oldestOnPage < cutoffDate();

      const pagesDone = offset / PAGE_SIZE + 1;
      if (!reachedCutoff && rows.length === PAGE_SIZE && pagesDone < pageLimit) {
        await ctx.scheduler.runAfter(0, internal.leads.syncLeadsPage, {
          offset: offset + PAGE_SIZE,
          mode,
        });
      } else {
        await ctx.runMutation(internal.leads.finishLeadSync, {});
      }
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS * (attempt + 1),
          internal.leads.syncLeadsPage,
          { offset, attempt: attempt + 1, mode },
        );
        return null;
      }
      await ctx.runMutation(internal.arbostar.recordSyncError, {
        source: "arbostar_leads",
        message: `leads: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return null;
  },
});

export const upsertLeads = internalMutation({
  args: {
    leads: v.array(
      v.object({
        arboId: v.number(),
        number: v.string(),
        createdAt: v.string(),
        source: v.string(),
        sourceId: v.optional(v.number()),
        statusName: v.string(),
        clientId: v.optional(v.number()),
        clientName: v.optional(v.string()),
        city: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { leads }) => {
    for (const lead of leads) {
      const existing = await ctx.db
        .query("leads")
        .withIndex("by_arboId", q => q.eq("arboId", lead.arboId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, lead);
      else await ctx.db.insert("leads", lead);
    }
    return null;
  },
});

export const finishLeadSync = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const count = (await ctx.db.query("leads").collect()).length;
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_source", q => q.eq("source", "arbostar_leads"))
      .unique();
    const row = {
      source: "arbostar_leads",
      status: "ok",
      recordCount: count,
      lastRunAt: Date.now(),
      lastSuccessAt: Date.now(),
      message: undefined,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("syncState", row);
    return null;
  },
});
