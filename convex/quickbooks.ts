import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { callTool, unwrapJson } from "./gateway";
import { PERIOD_KEYS, periodRange, priorYearRange } from "./periods";

/**
 * QuickBooks mirror.
 *
 * Revenue, gross profit, cash collected, payroll, operating expenses and
 * receivables aging all come from here, company wide, on a schedule.
 * ArboStar never supplies a cost figure: its work orders carry price only.
 */

type QbRow = {
  Header?: { ColData?: { value?: string }[] };
  Summary?: { ColData?: { value?: string }[] };
  ColData?: { value?: string }[];
  Rows?: { Row?: QbRow[] };
  group?: string;
  type?: string;
};

type QbReport = { Rows?: { Row?: QbRow[] } };

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const cleaned = value.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowLabel(row: QbRow): string {
  return (
    row.Header?.ColData?.[0]?.value ??
    row.Summary?.ColData?.[0]?.value ??
    row.ColData?.[0]?.value ??
    ""
  );
}

function rowAmount(row: QbRow): number | undefined {
  const cols =
    row.Summary?.ColData ?? row.ColData ?? row.Header?.ColData ?? undefined;
  if (!cols || cols.length < 2) return undefined;
  return toNumber(cols[cols.length - 1]?.value);
}

/** Depth first search for the first row whose label or group matches. */
function findRow(
  report: QbReport | QbRow,
  match: (label: string, group: string) => boolean,
): QbRow | undefined {
  const rows = report.Rows?.Row ?? [];
  for (const row of rows) {
    if (match(rowLabel(row).toLowerCase(), (row.group ?? "").toLowerCase())) {
      return row;
    }
    const nested = findRow(row, match);
    if (nested) return nested;
  }
  return undefined;
}

function amountFor(
  report: QbReport,
  match: (label: string, group: string) => boolean,
): number | undefined {
  const row = findRow(report, match);
  return row ? rowAmount(row) : undefined;
}

/** Sum every leaf row whose label matches, used for payroll style groupings. */
function sumMatching(report: QbReport | QbRow, needles: string[]): number {
  let total = 0;
  const rows = report.Rows?.Row ?? [];
  for (const row of rows) {
    const label = rowLabel(row).toLowerCase();
    if (needles.some(n => label.includes(n))) {
      total += rowAmount(row) ?? 0;
    } else {
      total += sumMatching(row, needles);
    }
  }
  return total;
}

async function profitAndLoss(start: string, end: string): Promise<QbReport> {
  const raw = await callTool<unknown>("mcp_quickbooks_run_profit_loss_report", {
    start_date: start,
    end_date: end,
    accounting_method: "Accrual",
  });
  return unwrapJson(raw) as QbReport;
}

function readProfitAndLoss(report: QbReport) {
  const revenue =
    amountFor(report, (label, group) => group === "income" || label === "total income") ??
    amountFor(report, label => label.startsWith("total income"));
  const cogs =
    amountFor(report, (label, group) => group === "cos" || label === "total cost of goods sold") ??
    amountFor(report, label => label.startsWith("total cost of"));
  const expenses = amountFor(
    report,
    (label, group) => group === "expenses" || label === "total expenses",
  );
  const payroll = sumMatching(report, ["payroll", "wages", "salaries", "labor"]);
  const debtService = sumMatching(report, ["interest expense", "loan"]);
  const grossProfit =
    revenue !== undefined && cogs !== undefined ? revenue - cogs : undefined;
  return {
    revenue,
    grossProfit,
    operatingExpenses: expenses,
    payroll: payroll || undefined,
    debtService: debtService || undefined,
  };
}

export const syncFinance = internalAction({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    try {
      const aging = unwrapJson(
        await callTool<unknown>("mcp_quickbooks_run_aged_receivables_report", {}),
      ) as QbReport;

      const receivables = {
        receivablesCurrent: undefined as number | undefined,
        receivables1to30: undefined as number | undefined,
        receivables31to60: undefined as number | undefined,
        receivables60plus: undefined as number | undefined,
        receivables60plusCount: undefined as number | undefined,
      };
      // The aged receivables report lays the buckets out as columns on the
      // total row: current, 1-30, 31-60, 61-90, 91 and over.
      const totalRow = findRow(aging, label => label.startsWith("total"));
      const cols = totalRow?.Summary?.ColData ?? totalRow?.ColData ?? [];
      if (cols.length >= 6) {
        receivables.receivablesCurrent = toNumber(cols[1]?.value);
        receivables.receivables1to30 = toNumber(cols[2]?.value);
        receivables.receivables31to60 = toNumber(cols[3]?.value);
        receivables.receivables60plus =
          (toNumber(cols[4]?.value) ?? 0) + (toNumber(cols[5]?.value) ?? 0);
      }

      for (const periodKey of PERIOD_KEYS) {
        const range = periodRange(periodKey);
        const prior = priorYearRange(range);
        const current = readProfitAndLoss(await profitAndLoss(range.start, range.end));
        const priorYear = readProfitAndLoss(await profitAndLoss(prior.start, prior.end));

        await ctx.runMutation(internal.quickbooks.storeFinance, {
          periodKey,
          line: "all",
          revenue: current.revenue,
          grossProfit: current.grossProfit,
          payroll: current.payroll,
          operatingExpenses: current.operatingExpenses,
          debtService: current.debtService,
          revenuePriorYear: priorYear.revenue,
          grossProfitPriorYear: priorYear.grossProfit,
          ...receivables,
        });
      }

      await ctx.runMutation(internal.quickbooks.markSync, {
        status: "ok",
        message: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.quickbooks.markSync, {
        status: message.toLowerCase().includes("expired") ? "unavailable" : "error",
        message,
      });
    }
    return null;
  },
});

export const storeFinance = internalMutation({
  args: {
    periodKey: v.string(),
    line: v.union(v.literal("all"), v.literal("production"), v.literal("phc")),
    revenue: v.optional(v.number()),
    grossProfit: v.optional(v.number()),
    cashCollected: v.optional(v.number()),
    payroll: v.optional(v.number()),
    operatingExpenses: v.optional(v.number()),
    debtService: v.optional(v.number()),
    revenuePriorYear: v.optional(v.number()),
    grossProfitPriorYear: v.optional(v.number()),
    receivablesCurrent: v.optional(v.number()),
    receivables1to30: v.optional(v.number()),
    receivables31to60: v.optional(v.number()),
    receivables60plus: v.optional(v.number()),
    receivables60plusCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("finance")
      .withIndex("by_periodKey_and_line", q =>
        q.eq("periodKey", args.periodKey).eq("line", args.line),
      )
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("finance", doc);
    return null;
  },
});

export const markSync = internalMutation({
  args: { status: v.string(), message: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { status, message }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_source", q => q.eq("source", "quickbooks"))
      .unique();
    const patch = {
      source: "quickbooks",
      status,
      message,
      lastRunAt: now,
      lastSuccessAt:
        status === "ok" ? now : (existing?.lastSuccessAt ?? undefined),
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("syncState", patch);
    return null;
  },
});
