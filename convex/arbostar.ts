import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { arbostarGet } from "./gateway";
import {
  isFinishedStatus,
  lineFromClassNames,
  lineFromStatusName,
  serviceTypeName,
} from "./serviceLine";

/**
 * ArboStar mirror.
 *
 * Work orders and estimates are pulled page by page on a schedule and
 * written into Convex. Pages chain through the scheduler so no single
 * action run has to hold the whole history.
 */

const PAGE_SIZE = 100;
/** Two years back: enough for trailing twelve months plus a prior year comparison. */
const HISTORY_DAYS = 800;
/** ArboStar is behind Cloudflare, so transient 520s are retried. */
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 20000;

function cutoffDate(): string {
  const d = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function dateOnly(value: unknown): string {
  if (typeof value !== "string" || value.length < 10) return "";
  return value.slice(0, 10);
}

// ---------------------------------------------------------------- work orders

export const syncJobsPage = internalAction({
  args: { offset: v.number(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { offset, attempt: attemptArg }) => {
    const attempt = attemptArg ?? 0;
    try {
      const page = await arbostarGet("/api/v1/workorders", {
        limit: PAGE_SIZE,
        offset,
        date_from: cutoffDate(),
        date_to: today(),
      });
      const rows = (page.data ?? []) as Record<string, any>[];

      const jobs = rows.map(row => {
        const address = (row.address ?? {}) as Record<string, any>;
        const client = (row.client ?? {}) as Record<string, any>;
        const totals = (row.totals ?? {}) as Record<string, any>;
        const statusName = String(row.status?.name ?? "");
        const value = num(totals.sum_actual_without_tax);
        const withTax = num(totals.total_with_tax);
        return {
          arboId: Number(row.id),
          number: String(row.number ?? ""),
          createdAt: dateOnly(row.created_at),
          statusName,
          statusId: row.status?.id === undefined ? undefined : Number(row.status.id),
          estimateId: row.estimate?.id === undefined ? undefined : Number(row.estimate.id),
          serviceLine: lineFromStatusName(statusName),
          city: address.city ? String(address.city) : undefined,
          state: address.state ? String(address.state) : undefined,
          zip: address.zip ? String(address.zip) : undefined,
          lat: typeof address.lat === "number" ? address.lat : undefined,
          lon: typeof address.lon === "number" ? address.lon : undefined,
          clientName: client.name ? String(client.name) : undefined,
          clientId: client.id === undefined ? undefined : Number(client.id),
          value: value || withTax - num(totals.total_tax),
          invoiced: withTax,
          paid: num(totals.payments_total),
          due: num(totals.total_due),
          finished: isFinishedStatus(statusName),
        };
      });

      await ctx.runMutation(internal.arbostar.upsertJobs, { jobs });

      const total = Number(page.total ?? 0);
      const nextOffset = offset + PAGE_SIZE;
      if (rows.length === PAGE_SIZE && nextOffset < total) {
        await ctx.scheduler.runAfter(0, internal.arbostar.syncJobsPage, {
          offset: nextOffset,
        });
      } else {
        await ctx.runMutation(internal.arbostar.finishJobSync, { total });
      }
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS * (attempt + 1),
          internal.arbostar.syncJobsPage,
          { offset, attempt: attempt + 1 },
        );
        return null;
      }
      await ctx.runMutation(internal.arbostar.recordSyncError, {
        source: "arbostar",
        message: `work orders: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return null;
  },
});

export const upsertJobs = internalMutation({
  args: {
    jobs: v.array(
      v.object({
        arboId: v.number(),
        number: v.string(),
        createdAt: v.string(),
        statusName: v.string(),
        statusId: v.optional(v.number()),
        estimateId: v.optional(v.number()),
        serviceLine: v.optional(
          v.union(v.literal("production"), v.literal("phc")),
        ),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        lat: v.optional(v.number()),
        lon: v.optional(v.number()),
        clientName: v.optional(v.string()),
        clientId: v.optional(v.number()),
        value: v.number(),
        invoiced: v.number(),
        paid: v.number(),
        due: v.number(),
        finished: v.boolean(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { jobs }) => {
    for (const job of jobs) {
      const existing = await ctx.db
        .query("jobs")
        .withIndex("by_arboId", q => q.eq("arboId", job.arboId))
        .unique();
      if (existing) {
        // Keep a service line already resolved from estimate line items.
        await ctx.db.patch(existing._id, {
          ...job,
          serviceLine: job.serviceLine ?? existing.serviceLine,
        });
      } else {
        await ctx.db.insert("jobs", job);
      }
    }
    return null;
  },
});

export const finishJobSync = internalMutation({
  args: { total: v.number() },
  returns: v.null(),
  handler: async (ctx, { total }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_source", q => q.eq("source", "arbostar"))
      .unique();
    const patch = {
      source: "arbostar",
      status: "ok",
      message: undefined,
      recordCount: total,
      lastSuccessAt: now,
      lastRunAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("syncState", patch);
    return null;
  },
});

// ------------------------------------------------------------------ estimates

/**
 * The estimates endpoint has no date filter, so the mirror walks backwards
 * from the newest record and stops once a page falls before the cutoff.
 */
export const syncEstimatesPage = internalAction({
  args: { offset: v.optional(v.number()), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { offset, attempt: attemptArg }) => {
    const attempt = attemptArg ?? 0;
    try {
      let startOffset = offset;
      if (startOffset === undefined) {
        const head = await arbostarGet("/api/v1/estimates", { limit: 1 });
        const total = Number(head.total_rows ?? head.total ?? 0);
        startOffset = Math.max(0, total - PAGE_SIZE);
      }

      const page = await arbostarGet("/api/v1/estimates", {
        limit: PAGE_SIZE,
        offset: startOffset,
      });
      const rows = (page.data ?? []) as Record<string, any>[];
      const cutoff = cutoffDate();

      const estimates = rows.map(row => {
        const totals = (row.totals ?? {}) as Record<string, any>;
        const items = (row.items ?? []) as Record<string, any>[];
        const statusName = String(row.status?.name ?? "");
        const classNames = items.map(item => {
          const cls = item.class;
          return cls && typeof cls === "object" ? String(cls.name ?? "") : undefined;
        });
        const withTax = num(totals.total_with_tax);
        const address = (row.address ?? {}) as Record<string, any>;
        const client = (row.client ?? {}) as Record<string, any>;
        // The largest priced line names the estimate, the way the office
        // would describe it on the phone.
        const largest = items
          .slice()
          .sort((a, b) => num(b.price) * (num(b.qty) || 1) - num(a.price) * (num(a.qty) || 1))[0];
        return {
          arboId: Number(row.id),
          number: String(row.number ?? ""),
          createdAt: dateOnly(row.created_at),
          statusName,
          sold: soldStatus(statusName),
          open: openStatus(statusName),
          serviceLine: lineFromClassNames(classNames),
          valueExTax: withTax - num(totals.total_tax),
          topItem: largest
            ? serviceTypeName(String(largest.item?.name ?? largest.name ?? ""))
            : undefined,
          city: address.city ? String(address.city) : (client.city ? String(client.city) : undefined),
          clientName: client.name ? String(client.name) : undefined,
        };
      });

      await ctx.runMutation(internal.arbostar.upsertEstimates, { estimates });

      // Estimate ids are not strictly ordered by date, so a single old row
      // on a page must not end the walk. Stop only when the whole page is
      // older than the cutoff.
      const dates = estimates.map(e => e.createdAt).filter(Boolean).sort();
      const newestOnPage = dates[dates.length - 1];
      const reachedCutoff = newestOnPage !== undefined && newestOnPage < cutoff;

      if (!reachedCutoff && startOffset > 0) {
        await ctx.scheduler.runAfter(0, internal.arbostar.syncEstimatesPage, {
          offset: Math.max(0, startOffset - PAGE_SIZE),
        });
      }
    } catch (error) {
      if (attempt < MAX_ATTEMPTS && offset !== undefined) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS * (attempt + 1),
          internal.arbostar.syncEstimatesPage,
          { offset, attempt: attempt + 1 },
        );
        return null;
      }
      await ctx.runMutation(internal.arbostar.recordSyncError, {
        source: "arbostar_estimates",
        message: `estimates: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return null;
  },
});

function soldStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("confirmed") || s.includes("accepted") || s.includes("won");
}

function openStatus(status: string): boolean {
  const s = status.toLowerCase();
  if (soldStatus(status)) return false;
  return !(s.includes("declined") || s.includes("cancel") || s.includes("lost"));
}

export const upsertEstimates = internalMutation({
  args: {
    estimates: v.array(
      v.object({
        arboId: v.number(),
        number: v.string(),
        createdAt: v.string(),
        statusName: v.string(),
        sold: v.boolean(),
        open: v.boolean(),
        serviceLine: v.optional(
          v.union(v.literal("production"), v.literal("phc")),
        ),
        valueExTax: v.number(),
        topItem: v.optional(v.string()),
        city: v.optional(v.string()),
        clientName: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { estimates }) => {
    for (const estimate of estimates) {
      const existing = await ctx.db
        .query("estimates")
        .withIndex("by_arboId", q => q.eq("arboId", estimate.arboId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, estimate);
      else await ctx.db.insert("estimates", estimate);

      // The estimate carries the line item classes, so it is the better
      // source of the service line for its work order.
      if (estimate.serviceLine) {
        const job = await ctx.db
          .query("jobs")
          .withIndex("by_estimateId", q => q.eq("estimateId", estimate.arboId))
          .first();
        if (job && job.serviceLine !== estimate.serviceLine) {
          await ctx.db.patch(job._id, { serviceLine: estimate.serviceLine });
        }
      }
    }
    return null;
  },
});

export const recordSyncError = internalMutation({
  args: { source: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, { source, message: raw }) => {
    const now = Date.now();
    // Cloudflare error pages arrive as whole HTML documents. The header only
    // needs the first line of a failure, not a page of markup.
    const message = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 200);
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_source", q => q.eq("source", source))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "error",
        message,
        lastRunAt: now,
      });
    } else {
      await ctx.db.insert("syncState", {
        source,
        status: "error",
        message,
        lastRunAt: now,
      });
    }
    return null;
  },
});

/** Entry point used by the hourly cron and by the header refresh button. */
export const syncAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    await ctx.scheduler.runAfter(0, internal.arbostar.syncJobsPage, { offset: 0 });
    await ctx.scheduler.runAfter(0, internal.arbostar.syncEstimatesPage, {});
    await ctx.scheduler.runAfter(0, internal.invoices.syncInvoicesPage, {
      mode: "recent",
    });
    await ctx.scheduler.runAfter(0, internal.leads.syncLeadsPage, {});
    await ctx.scheduler.runAfter(0, internal.leadSheet.syncLeadSheet, {});
    await ctx.scheduler.runAfter(0, internal.quickbooks.syncFinance, {});
    return null;
  },
});
