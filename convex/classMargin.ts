import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { callTool, unwrapJson } from "./gateway";
import { todayInCentral, type PeriodKey } from "./periods";
import { amountFor, profitAndLoss, sumMatching } from "./quickbooks";

/**
 * Profit by type of work.
 *
 * QuickBooks classes are how TreeNewal already tags work (Production, Plant
 * Health, Stump Grind, GOV and so on). The connector exposes no profit and
 * loss summarised by class, so revenue and direct cost are assembled from
 * the class tag on individual transaction lines.
 *
 * Two rules keep this honest:
 *   1. Nothing is reallocated silently. Lines with no class land in an
 *      "Unclassed" row that is shown, so the rows always add up to the
 *      profit and loss totals on the Overview screen.
 *   2. Overhead is not tagged by class in any usable way (the payroll
 *      journal entries post offsetting credits to untagged accounts), so
 *      overhead is never scraped per class. It is taken as a single total
 *      and, when the allocation toggle is on, spread across classes by
 *      share of revenue. That is an allocation, not a measurement, and the
 *      interface says so.
 *
 * Figures are stored one calendar month at a time so any period is a sum of
 * months rather than a fresh scrape of thousands of transactions.
 */

const REVENUE_ENTITIES = [
  "Invoice",
  "CreditMemo",
  "SalesReceipt",
  "RefundReceipt",
  "JournalEntry",
] as const;

const COST_ENTITIES = [
  "Bill",
  "Purchase",
  "VendorCredit",
  "JournalEntry",
] as const;

const UNCLASSED = "Unclassed";

type QbLineDetail = {
  AccountRef?: { value?: string; name?: string };
  ItemAccountRef?: { value?: string; name?: string };
  ClassRef?: { value?: string; name?: string };
  PostingType?: string;
  Line?: QbLine[];
};

type QbLine = {
  Amount?: number;
  DetailType?: string;
  [key: string]: unknown;
};

type QbTxn = {
  ClassRef?: { value?: string; name?: string };
  Credit?: boolean;
  Line?: QbLine[];
};

type QbAccount = {
  Id?: string;
  FullyQualifiedName?: string;
  AccountType?: string;
};

async function queryAll<T>(entity: string, where: string): Promise<T[]> {
  const rows: T[] = [];
  let position = 1;
  // QuickBooks caps a page at 100 and has no cursor, so it is offset paging.
  for (let page = 0; page < 60; page += 1) {
    const raw = await callTool<unknown>("mcp_quickbooks_run_custom_query", {
      query: `SELECT * FROM ${entity} WHERE ${where} STARTPOSITION ${position} MAXRESULTS 100`,
    });
    const parsed = unwrapJson(raw) as
      | { QueryResponse?: Record<string, T[]> }
      | undefined;
    const batch = parsed?.QueryResponse?.[entity] ?? [];
    rows.push(...batch);
    if (batch.length < 100) break;
    position += 100;
  }
  return rows;
}

/** Bundle items carry the class, so group lines have to be walked into. */
function* walkLines(
  lines: QbLine[] | undefined,
): Generator<[QbLine, QbLineDetail]> {
  for (const line of lines ?? []) {
    const detailType = line.DetailType;
    if (!detailType) continue;
    const detail = line[detailType] as QbLineDetail | undefined;
    if (detailType === "GroupLineDetail") {
      yield* walkLines(detail?.Line);
      continue;
    }
    if (!detail) continue;
    yield [line, detail];
  }
}

function accountFor(
  detail: QbLineDetail,
  accounts: Map<string, QbAccount>,
): QbAccount | undefined {
  const id = detail.AccountRef?.value ?? detail.ItemAccountRef?.value;
  return id ? accounts.get(id) : undefined;
}

function classNameFor(detail: QbLineDetail, txn: QbTxn): string {
  return detail.ClassRef?.name ?? txn.ClassRef?.name ?? UNCLASSED;
}

/**
 * Sign convention. Credit memos and refunds reduce revenue, vendor credits
 * reduce cost, and journal entries are explicit about which side they post.
 */
function signFor(entity: string, detail: QbLineDetail, txn: QbTxn, isIncome: boolean): number {
  if (entity === "JournalEntry") {
    const isCredit = detail.PostingType === "Credit";
    if (isIncome) return isCredit ? 1 : -1;
    return isCredit ? -1 : 1;
  }
  if (entity === "CreditMemo" || entity === "RefundReceipt" || entity === "VendorCredit") {
    return -1;
  }
  if (entity === "Purchase" && txn.Credit) return -1;
  return 1;
}

export const syncMonth = internalAction({
  args: { month: v.string() },
  returns: v.null(),
  handler: async (ctx, { month }) => {
    const [year, mon] = month.split("-").map(Number);
    const start = `${month}-01`;
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const end = `${month}-${String(lastDay).padStart(2, "0")}`;
    const where = `TxnDate >= '${start}' AND TxnDate <= '${end}'`;

    const accountRows = await queryAll<QbAccount>("Account", "Active IN (true, false)");
    const accounts = new Map<string, QbAccount>();
    for (const account of accountRows) {
      if (account.Id) accounts.set(account.Id, account);
    }

    const revenue: Record<string, number> = {};
    const directCost: Record<string, number> = {};

    const entities = new Set([...REVENUE_ENTITIES, ...COST_ENTITIES]);
    for (const entity of entities) {
      const txns = await queryAll<QbTxn>(entity, where);
      for (const txn of txns) {
        for (const [line, detail] of walkLines(txn.Line)) {
          const amount = Number(line.Amount ?? 0);
          if (!Number.isFinite(amount) || amount === 0) continue;
          const account = accountFor(detail, accounts);
          const type = account?.AccountType;
          const className = classNameFor(detail, txn);
          if (type === "Income" || type === "Other Income") {
            revenue[className] =
              (revenue[className] ?? 0) + amount * signFor(entity, detail, txn, true);
          } else if (type === "Cost of Goods Sold") {
            directCost[className] =
              (directCost[className] ?? 0) + amount * signFor(entity, detail, txn, false);
          }
        }
      }
    }

    // The profit and loss for the same month is the control total. Anything
    // the line scrape cannot reach (QuickBooks posts inventory cost of goods
    // automatically, with no line of its own) shows up as an explicit
    // unassigned row rather than quietly changing the class figures.
    const report = await profitAndLoss(start, end);
    const totalRevenue = amountFor(
      report,
      (label, group) => group === "income" || label === "total income",
    );
    const totalDirectCost = amountFor(
      report,
      (label, group) =>
        group === "cogs" || group === "cos" || label === "total cost of goods sold",
    );
    const totalExpenses = amountFor(
      report,
      (label, group) => group === "expenses" || label === "total expenses",
    );
    // Owner guaranteed payments are draws in substance, so they are not
    // overhead that a job has to carry.
    const ownerPay = sumMatching(report, ["guaranteed payments"]);

    await ctx.runMutation(internal.classMargin.storeMonth, {
      month,
      totalRevenue,
      totalDirectCost,
      overhead:
        totalExpenses === undefined ? undefined : totalExpenses - (ownerPay || 0),
      rows: Array.from(new Set([...Object.keys(revenue), ...Object.keys(directCost)]))
        .map(className => ({
          className,
          revenue: Math.round((revenue[className] ?? 0) * 100) / 100,
          directCost: Math.round((directCost[className] ?? 0) * 100) / 100,
        }))
        .filter(row => row.revenue !== 0 || row.directCost !== 0),
    });
    return null;
  },
});

/**
 * Rebuild the months that can still change. Earlier months are already
 * closed and are only built once, by the backfill.
 */
export const syncRecentMonths = internalAction({
  args: { count: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { count }) => {
    const today = todayInCentral();
    const [year, month] = today.split("-").map(Number);
    const months = count ?? 2;
    // Months already stored are skipped unless they are one of the two most
    // recent, which always get refreshed. This lets a fresh deployment fill
    // in its own thirteen month history on the first scheduled run.
    const stored = new Set(
      await ctx.runQuery(internal.classMargin.storedMonths, {}),
    );
    // Each month is its own scheduled action. A month takes a few dozen
    // QuickBooks calls, so running a year of them inside one action runs
    // past the time a single action is allowed.
    for (let back = 0; back < months; back += 1) {
      const shifted = new Date(Date.UTC(year, month - 1 - back, 1));
      const key = `${shifted.getUTCFullYear()}-${String(
        shifted.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      if (back > 1 && stored.has(key)) continue;
      await ctx.scheduler.runAfter(back * 90_000, internal.classMargin.syncMonth, {
        month: key,
      });
    }
    return null;
  },
});

export const storedMonths = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async ctx => {
    const rows = await ctx.db.query("classMonthly").collect();
    return rows.map(row => row.month);
  },
});

export const storeMonth = internalMutation({
  args: {
    month: v.string(),
    totalRevenue: v.optional(v.number()),
    totalDirectCost: v.optional(v.number()),
    overhead: v.optional(v.number()),
    rows: v.array(
      v.object({
        className: v.string(),
        revenue: v.number(),
        directCost: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { month } = args;
    const existing = await ctx.db
      .query("classMonthly")
      .withIndex("by_month", q => q.eq("month", month))
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("classMonthly", doc);
    return null;
  },
});

/** The calendar months a period covers, newest last. */
export function monthsForPeriod(period: PeriodKey, today: string): string[] {
  const [year, month] = today.split("-").map(Number);
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const back = (count: number) => {
    const out: string[] = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const shifted = new Date(Date.UTC(year, month - 1 - i, 1));
      out.push(key(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1));
    }
    return out;
  };
  switch (period) {
    case "mtd":
      return [key(year, month)];
    case "last_month":
      return back(2).slice(0, 1);
    case "qtd": {
      const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
      return back(month - quarterStart + 1);
    }
    case "ytd":
      return back(month);
    case "ttm":
      return back(12);
  }
}

export const byClass = query({
  args: { period: v.string(), allocateOverhead: v.boolean() },
  returns: v.object({
    rows: v.array(
      v.object({
        className: v.string(),
        revenue: v.number(),
        directCost: v.number(),
        allocatedOverhead: v.union(v.number(), v.null()),
        profit: v.number(),
        marginPct: v.union(v.number(), v.null()),
        isUnassigned: v.boolean(),
      }),
    ),
    totalRevenue: v.number(),
    totalDirectCost: v.number(),
    overhead: v.union(v.number(), v.null()),
    months: v.array(v.string()),
    complete: v.boolean(),
    updatedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { period, allocateOverhead }) => {
    const months = monthsForPeriod(period as PeriodKey, todayInCentral());
    const totals = new Map<string, { revenue: number; directCost: number }>();
    let controlRevenue = 0;
    let controlDirectCost = 0;
    let overhead = 0;
    let haveOverhead = false;
    let complete = true;
    let updatedAt: number | null = null;

    for (const month of months) {
      const doc = await ctx.db
        .query("classMonthly")
        .withIndex("by_month", q => q.eq("month", month))
        .unique();
      if (!doc) {
        complete = false;
        continue;
      }
      updatedAt = Math.max(updatedAt ?? 0, doc.updatedAt);
      for (const row of doc.rows) {
        const current = totals.get(row.className) ?? { revenue: 0, directCost: 0 };
        current.revenue += row.revenue;
        current.directCost += row.directCost;
        totals.set(row.className, current);
      }
      controlRevenue += doc.totalRevenue ?? 0;
      controlDirectCost += doc.totalDirectCost ?? 0;
      if (doc.overhead !== undefined) {
        overhead += doc.overhead;
        haveOverhead = true;
      }
    }

    const scrapedRevenue = Array.from(totals.values()).reduce(
      (sum, row) => sum + row.revenue,
      0,
    );
    const scrapedDirectCost = Array.from(totals.values()).reduce(
      (sum, row) => sum + row.directCost,
      0,
    );
    const totalRevenue = controlRevenue || scrapedRevenue;
    const totalDirectCost = controlDirectCost || scrapedDirectCost;

    // Whatever the class tags do not account for is its own visible row, so
    // the rows always add up to the figures on the Overview screen.
    const residualRevenue = round2(totalRevenue - scrapedRevenue);
    const residualDirectCost = round2(totalDirectCost - scrapedDirectCost);

    const base = Array.from(totals.entries()).map(([className, value]) => ({
      className,
      revenue: round2(value.revenue),
      directCost: round2(value.directCost),
      isUnassigned: className === UNCLASSED,
    }));
    if (Math.abs(residualRevenue) >= 1 || Math.abs(residualDirectCost) >= 1) {
      base.push({
        className: "Not assigned to a class",
        revenue: residualRevenue,
        directCost: residualDirectCost,
        isUnassigned: true,
      });
    }

    const allocate = allocateOverhead && haveOverhead && totalRevenue > 0;
    const rows = base
      .map(row => {
        const allocated = allocate
          ? round2(overhead * (row.revenue / totalRevenue))
          : null;
        const profit = round2(row.revenue - row.directCost - (allocated ?? 0));
        return {
          ...row,
          allocatedOverhead: allocated,
          profit,
          marginPct: row.revenue > 0 ? (profit / row.revenue) * 100 : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return {
      rows,
      totalRevenue: round2(totalRevenue),
      totalDirectCost: round2(totalDirectCost),
      overhead: haveOverhead ? round2(overhead) : null,
      months,
      complete,
      updatedAt,
    };
  },
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
