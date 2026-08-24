import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { arbostarGet } from "./gateway";
import {
  isConsultation,
  lineFromClassName,
  lineFromClassNames,
  serviceTypeName,
} from "./serviceLine";

/**
 * ArboStar invoice mirror.
 *
 * A job is closed on its invoice date. ArboStar has no completion date on a
 * work order, and the invoice is what QuickBooks bills on, so the invoice is
 * the honest closing signal and the two systems reconcile through the
 * QuickBooks id carried on every row.
 *
 * The endpoint ignores date filters and returns oldest first, so the mirror
 * walks backwards from the newest record. Payloads are heavy, so pages are
 * small.
 */

const PAGE_SIZE = 25;
/** Two years back: trailing twelve months plus a prior year comparison. */
const HISTORY_DAYS = 800;
/** A scheduled refresh only needs to catch recent invoices and payments. */
const RECENT_DAYS = 45;
/** ArboStar is behind Cloudflare, so transient 520s are retried. */
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 20000;

function cutoffDate(mode: "full" | "recent"): string {
  const days = mode === "full" ? HISTORY_DAYS : RECENT_DAYS;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : Number(value);
}

function optionalString(value: unknown): string | undefined {
  const text = value === undefined || value === null ? "" : String(value);
  return text.length > 0 ? text : undefined;
}

/** Class name from the first record that carries one, bundles included. */
function firstClassName(candidates: (Record<string, any> | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const cls = candidate?.class;
    if (cls && typeof cls === "object" && cls.name) return String(cls.name);
    if (typeof cls === "string" && cls.trim().length > 0) return cls.trim();
  }
  return undefined;
}

/** Lines that are money on the invoice but not delivered work. */
function isOverheadLine(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("tip") ||
    n.includes("fee") ||
    n.includes("discount") ||
    n.includes("adjustment") ||
    n.includes("deposit")
  );
}

type InvoiceRow = {
  arboId: number;
  number: string;
  date: string;
  workOrderId?: number;
  estimateId?: number;
  quickbooksId?: string;
  serviceLine?: "production" | "phc";
  consultation: boolean;
  excluded: boolean;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  clientName?: string;
  valueExTax: number;
  total: number;
  paidTotal: number;
  due: number;
  isPaid: boolean;
  payments: { date: string; amount: number }[];
  serviceTypes: { name: string; line?: "production" | "phc"; amount: number }[];
};

function toInvoice(row: Record<string, any>): InvoiceRow {
  const totals = (row.totals ?? {}) as Record<string, any>;
  const address = (row.address ?? {}) as Record<string, any>;
  const client = (row.client ?? {}) as Record<string, any>;
  const items = (row.items ?? []) as Record<string, any>[];
  const classNames = items.map(item =>
    firstClassName([
      item,
      item.item,
      item.product,
      ...((item.bundle_items ?? []) as Record<string, any>[]).flatMap(child => [
        child,
        child.item,
      ]),
    ]),
  );
  const payments = ((row.payments ?? []) as Record<string, any>[]).map(payment => ({
    date: dateOnly(payment.created_at),
    amount: num(payment.amount),
  }));
  const descriptions = items.map(item => String(item.description ?? "").toLowerCase());
  // Delivered work only. Card fees, tips and scheduling notes are overhead
  // or zero value lines and never a service type.
  const serviceTypes: { name: string; line?: "production" | "phc"; amount: number }[] = [];
  for (const item of items) {
    // A bundle carries its class on the child rows, so the class is read from
    // the item, then the catalogue entry, then the bundle children.
    const className = firstClassName([
      item,
      item.item,
      ...((item.bundle_items ?? []) as Record<string, any>[]).flatMap(child => [
        child,
        child.item,
      ]),
    ]);
    const line = lineFromClassName(className);
    if (line === undefined) continue;
    const name = serviceTypeName(String(item.item?.name ?? item.name ?? ""));
    // price is the line total already, qty is the dosage or tree count, so
    // multiplying the two inflates chemical lines by orders of magnitude.
    const amount = num(item.price);
    if (!name || amount <= 0 || isOverheadLine(name)) continue;
    const found = serviceTypes.find(t => t.name === name);
    if (found) found.amount += amount;
    else serviceTypes.push({ name, line, amount });
  }

  const withTax = num(totals.total_with_tax);
  const exTax = num(totals.sum_without_tax) || withTax - num(totals.total_tax);

  return {
    arboId: Number(row.id),
    number: String(row.number ?? ""),
    date: dateOnly(row.created_at),
    workOrderId: optionalNumber(row.workorder?.id),
    estimateId: optionalNumber(row.estimate?.id),
    quickbooksId: optionalString(row.integration_id),
    serviceLine: lineFromClassNames(classNames),
    consultation: isConsultation(classNames),
    // Tax adjustments and zero value warranty invoices are bookkeeping, not work.
    excluded:
      exTax <= 0 ||
      (descriptions.length > 0 &&
        descriptions.every(text => text.includes("tax adjustment"))),
    city: optionalString(address.city ?? client.city),
    state: optionalString(address.state ?? client.state),
    zip: optionalString(address.zip ?? client.zip),
    lat: typeof address.lat === "number" ? address.lat : undefined,
    lon: typeof address.lon === "number" ? address.lon : undefined,
    clientName: optionalString(client.name),
    valueExTax: exTax,
    total: withTax,
    paidTotal: num(totals.sum_payment_total),
    due: num(totals.total_due),
    isPaid: Boolean(row.status?.is_paid),
    payments,
    serviceTypes,
  };
}

export const syncInvoicesPage = internalAction({
  args: {
    offset: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("full"), v.literal("recent"))),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mode = args.mode ?? "recent";
    const attempt = args.attempt ?? 0;
    try {
      let startOffset = args.offset;
      if (startOffset === undefined) {
        const head = await arbostarGet("/api/v1/invoices", { limit: 1 });
        const total = Number(head.total_rows ?? head.total ?? 0);
        startOffset = Math.max(0, total - PAGE_SIZE);
      }

      const page = await arbostarGet("/api/v1/invoices", {
        limit: PAGE_SIZE,
        offset: startOffset,
      });
      const rows = (page.data ?? []) as Record<string, any>[];
      const invoices = rows.map(toInvoice);

      await ctx.runMutation(internal.invoices.upsertInvoices, { invoices });

      // Ids are not strictly date ordered, so one old row must not end the
      // walk. Stop only once the newest row on the page is past the cutoff.
      const dates = invoices.map(i => i.date).filter(Boolean).sort();
      const newestOnPage = dates[dates.length - 1];
      const reachedCutoff =
        newestOnPage !== undefined && newestOnPage < cutoffDate(mode);

      if (!reachedCutoff && startOffset > 0) {
        await ctx.scheduler.runAfter(0, internal.invoices.syncInvoicesPage, {
          offset: Math.max(0, startOffset - PAGE_SIZE),
          mode,
        });
      } else {
        await ctx.runMutation(internal.invoices.finishInvoiceSync, {});
      }
    } catch (error) {
      // ArboStar sits behind Cloudflare and returns the occasional 520 or
      // gateway timeout. A transient failure must not end a backfill that
      // has hours of work behind it, so the page is retried with a backoff.
      if (attempt < MAX_ATTEMPTS && args.offset !== undefined) {
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS * (attempt + 1),
          internal.invoices.syncInvoicesPage,
          { offset: args.offset, mode, attempt: attempt + 1 },
        );
        return null;
      }
      await ctx.runMutation(internal.arbostar.recordSyncError, {
        source: "arbostar_invoices",
        message: `invoices: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return null;
  },
});

export const upsertInvoices = internalMutation({
  args: {
    invoices: v.array(
      v.object({
        arboId: v.number(),
        number: v.string(),
        date: v.string(),
        workOrderId: v.optional(v.number()),
        estimateId: v.optional(v.number()),
        quickbooksId: v.optional(v.string()),
        serviceLine: v.optional(
          v.union(v.literal("production"), v.literal("phc")),
        ),
        consultation: v.boolean(),
        excluded: v.boolean(),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        lat: v.optional(v.number()),
        lon: v.optional(v.number()),
        clientName: v.optional(v.string()),
        valueExTax: v.number(),
        total: v.number(),
        paidTotal: v.number(),
        due: v.number(),
        isPaid: v.boolean(),
        payments: v.array(v.object({ date: v.string(), amount: v.number() })),
        serviceTypes: v.array(
          v.object({
            name: v.string(),
            line: v.optional(
              v.union(v.literal("production"), v.literal("phc")),
            ),
            amount: v.number(),
          }),
        ),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { invoices }) => {
    for (const invoice of invoices) {
      const existing = await ctx.db
        .query("invoices")
        .withIndex("by_arboId", q => q.eq("arboId", invoice.arboId))
        .unique();

      // The work order carries the map coordinates and, through its
      // estimate, a service line resolved from line item classes.
      let enriched = invoice;
      if (invoice.workOrderId !== undefined) {
        const job = await ctx.db
          .query("jobs")
          .withIndex("by_arboId", q => q.eq("arboId", invoice.workOrderId!))
          .unique();
        if (job) {
          enriched = {
            ...invoice,
            serviceLine: invoice.serviceLine ?? job.serviceLine,
            city: invoice.city ?? job.city,
            state: invoice.state ?? job.state,
            zip: invoice.zip ?? job.zip,
            lat: invoice.lat ?? job.lat,
            lon: invoice.lon ?? job.lon,
          };
        }
      }

      if (existing) await ctx.db.patch(existing._id, enriched);
      else await ctx.db.insert("invoices", enriched);
    }
    return null;
  },
});

export const finishInvoiceSync = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const now = Date.now();
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_source", q => q.eq("source", "arbostar_invoices"))
      .unique();
    const count = (await ctx.db.query("invoices").collect()).length;
    const patch = {
      source: "arbostar_invoices",
      status: "ok",
      message: undefined,
      recordCount: count,
      lastSuccessAt: now,
      lastRunAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("syncState", patch);
    return null;
  },
});
