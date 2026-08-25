import { v } from "convex/values";
import { backlogAt, backlogInputs } from "./backlog";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import {
  type DateRange,
  type PeriodKey,
  periodRange,
  todayInCentral,
} from "./periods";

/**
 * Every figure on the Overview, computed from the Convex mirror.
 *
 * Two rates are kept distinct by name and never share a label:
 *   proposal value won = dollars won over dollars proposed
 *   close rate         = jobs sold over estimates issued
 *
 * Backlog is always expressed in weeks against the 2.5 to 3 week target band.
 */

export const TARGET_BAND = { low: 2.5, high: 3 } as const;

const lineArg = v.union(v.literal("all"), v.literal("production"), v.literal("phc"));
const periodArg = v.union(
  v.literal("mtd"),
  v.literal("last_month"),
  v.literal("qtd"),
  v.literal("ytd"),
  v.literal("ttm"),
);

type Line = "all" | "production" | "phc";

/**
 * Plant health care is tagged explicitly by the ArboStar class and by the
 * work order status. Everything else delivered is production work, so an
 * untagged record reads as production rather than falling out of the split.
 */
function effectiveLine(recordLine: string | undefined): "production" | "phc" {
  return recordLine === "phc" ? "phc" : "production";
}

function matchesLine(recordLine: string | undefined, line: Line): boolean {
  if (line === "all") return true;
  return effectiveLine(recordLine) === line;
}

/**
 * The closed job set. A job closes on its invoice date, which is what
 * QuickBooks bills on too, so the two systems agree on when work landed.
 * Average job value, the city rows and the map all read this one set.
 */
async function invoicesInRange(
  ctx: QueryCtx,
  range: DateRange,
): Promise<Doc<"invoices">[]> {
  return await ctx.db
    .query("invoices")
    .withIndex("by_date", q => q.gte("date", range.start).lte("date", range.end))
    .collect();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const nullableNumber = v.union(v.number(), v.null());

export const overview = authenticatedQuery({
  args: { period: periodArg, line: lineArg },
  returns: v.any(),
  handler: async (ctx, { period, line }) => {
    await requireScreen(ctx, "overview");

    const now = Date.now();
    const range = periodRange(period as PeriodKey, now);

    // ---- the job set. Average job value, the city rows and the map all
    // read this same set, so the three always reconcile.
    const allInvoices = await invoicesInRange(ctx, range);
    const inLine = allInvoices.filter(
      inv => !inv.excluded && matchesLine(inv.serviceLine, line),
    );
    // Arborist consultations are lead generation, not delivered work, so
    // they are reported on their own rather than inside average job value.
    const consultations = inLine.filter(inv => inv.consultation);
    const closedJobs = inLine.filter(inv => !inv.consultation);
    const closedValue = sum(closedJobs.map(job => job.valueExTax));
    const averageJobValue =
      closedJobs.length > 0 ? Math.round(closedValue / closedJobs.length) : null;

    // ---- pipeline
    const estimates = (
      await ctx.db
        .query("estimates")
        .withIndex("by_createdAt", q =>
          q.gte("createdAt", range.start).lte("createdAt", range.end),
        )
        .collect()
    ).filter(estimate => matchesLine(estimate.serviceLine, line));

    const sold = estimates.filter(estimate => estimate.sold);
    const valueProposed = sum(estimates.map(estimate => estimate.valueExTax));
    const valueSold = sum(sold.map(estimate => estimate.valueExTax));
    const openValueProposed = sum(
      estimates.filter(estimate => estimate.open).map(estimate => estimate.valueExTax),
    );

    const proposalValueWonFor = (which: Line) => {
      const subset = estimates.filter(estimate => matchesLine(estimate.serviceLine, which));
      const proposed = sum(subset.map(estimate => estimate.valueExTax));
      const won = sum(
        subset.filter(estimate => estimate.sold).map(estimate => estimate.valueExTax),
      );
      return proposed > 0 ? round((won / proposed) * 100, 1) : null;
    };

    // ---- backlog, in weeks against the target band. The rule lives in
    // backlog.ts and is shared with the Jobs screen, so the two agree.
    const inputs = await backlogInputs(ctx);
    const asOf = todayInCentral(now);
    const backlogAll = backlogAt(inputs, asOf, line);
    const backlogProduction = backlogAt(inputs, asOf, "production");
    const backlogPhc = backlogAt(inputs, asOf, "phc");

    // ---- QuickBooks figures, or null when the connection is not live
    const finance = await ctx.db
      .query("finance")
      .withIndex("by_periodKey_and_line", q =>
        q.eq("periodKey", period as string).eq("line", "all"),
      )
      .unique();

    // The leads sheet, for return on paid ad spend.
    const spendRows = await ctx.db.query("leadSpend").collect();
    const periodMonths: string[] = [];
    {
      let cursor = range.start.slice(0, 7);
      const last = range.end.slice(0, 7);
      while (cursor <= last && periodMonths.length < 24) {
        periodMonths.push(cursor);
        const [y, m] = cursor.split("-").map(Number);
        cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      }
    }

    const syncRows = await ctx.db.query("syncState").collect();
    const arbostar = syncRows.find(row => row.source === "arbostar");
    const quickbooks = syncRows.find(row => row.source === "quickbooks");

    const jobsByLine = (which: "production" | "phc") =>
      closedJobs.filter(job => effectiveLine(job.serviceLine) === which);
    const lineValue = (which: "production" | "phc") =>
      Math.round(sum(jobsByLine(which).map(job => job.valueExTax)));

    return {
      range,
      period,
      line,
      jobSet: {
        jobsClosed: closedJobs.length,
        closedValue: Math.round(closedValue),
        averageJobValue,
        medianJobValue: median(closedJobs.map(job => job.valueExTax)),
        largestJobValue:
          closedJobs.length > 0
            ? Math.round(Math.max(...closedJobs.map(job => job.valueExTax)))
            : null,
        consultations: {
          count: consultations.length,
          value: Math.round(sum(consultations.map(inv => inv.valueExTax))),
        },
        recent: closedJobs
          .slice()
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .slice(0, 12)
          .map(job => ({
            date: job.date,
            city: job.city ?? "",
            serviceLine: effectiveLine(job.serviceLine),
            value: Math.round(job.valueExTax),
          })),
      },
      serviceLines: {
        production: {
          jobsClosed: jobsByLine("production").length,
          jobValue: lineValue("production"),
          backlogWeeks: backlogProduction.weeks,
        },
        phc: {
          jobsClosed: jobsByLine("phc").length,
          jobValue: lineValue("phc"),
          backlogWeeks: backlogPhc.weeks,
        },
      },
      pipeline: {
        estimatesIssued: estimates.length,
        valueProposed: Math.round(valueProposed),
        jobsSold: sold.length,
        valueSold: Math.round(valueSold),
        // dollars won over dollars proposed
        proposalValueWon: valueProposed > 0 ? round((valueSold / valueProposed) * 100, 1) : null,
        proposalValueWonProduction: proposalValueWonFor("production"),
        proposalValueWonPhc: proposalValueWonFor("phc"),
        // jobs sold over estimates issued
        closeRate:
          estimates.length > 0 ? round((sold.length / estimates.length) * 100, 1) : null,
        openValueProposed: Math.round(openValueProposed),
      },
      backlog: {
        weeks: backlogAll.weeks,
        openValue: Math.round(backlogAll.openValue),
        weeklyRunRate: Math.round(backlogAll.weeklyRunRate),
        targetLow: TARGET_BAND.low,
        targetHigh: TARGET_BAND.high,
        shortestLine:
          backlogProduction.weeks !== null && backlogPhc.weeks !== null
            ? backlogProduction.weeks <= backlogPhc.weeks
              ? "Production"
              : "Plant Health Care"
            : null,
      },
      finance: finance
        ? {
            revenue: finance.revenue ?? null,
            grossProfit: finance.grossProfit ?? null,
            cashCollected: finance.cashCollected ?? null,
            payroll: finance.payroll ?? null,
            fieldLabor: finance.fieldLabor ?? null,
            overheadPayroll: finance.overheadPayroll ?? null,
            subcontractorLabor: finance.subcontractorLabor ?? null,
            netIncome: finance.netIncome ?? null,
            operatingExpenses: finance.operatingExpenses ?? null,
            opexBudget: finance.opexBudget ?? null,
            debtService: finance.debtService ?? null,
            revenuePriorYear: finance.revenuePriorYear ?? null,
            grossProfitPriorYear: finance.grossProfitPriorYear ?? null,
            cashCollectedPriorYear: finance.cashCollectedPriorYear ?? null,
            receivablesCurrent: finance.receivablesCurrent ?? null,
            receivables1to30: finance.receivables1to30 ?? null,
            receivables31to60: finance.receivables31to60 ?? null,
            receivables60plus: finance.receivables60plus ?? null,
          }
        : null,
      // Receivables and marketing return no longer wait on QuickBooks and
      // Google Ads: the invoice mirror carries what is owed, and the leads
      // sheet carries media cost.
      receivables: (() => {
        const open = inputs.invoices.filter(
          invoice => !invoice.excluded && !invoice.isPaid && invoice.due > 0.5,
        );
        return {
          total: Math.round(open.reduce((sum, invoice) => sum + invoice.due, 0)),
          count: open.length,
        };
      })(),
      marketingReturn: (() => {
        const rows = spendRows.filter(row => periodMonths.includes(row.month));
        const filled = new Set(
          spendRows
            .filter(row => row.channel === "total" && (row.leads ?? 0) > 0)
            .map(row => row.month),
        );
        const paid = rows.filter(
          row => row.channel === "paid" && filled.has(row.month),
        );
        const cost = paid.reduce((total, row) => total + (row.cost ?? 0), 0);
        const revenue = paid.reduce((total, row) => total + (row.revenue ?? 0), 0);
        return {
          spend: Math.round(cost),
          revenue: Math.round(revenue),
          returnOnSpend:
            cost > 0 ? Math.round((revenue / cost) * 10) / 10 : null,
        };
      })(),
      sources: {
        arbostar: arbostar
          ? {
              status: arbostar.status,
              message: arbostar.message ?? null,
              lastSuccessAt: arbostar.lastSuccessAt ?? null,
            }
          : null,
        quickbooks: quickbooks
          ? {
              status: quickbooks.status,
              message: quickbooks.message ?? null,
              lastSuccessAt: quickbooks.lastSuccessAt ?? null,
            }
          : null,
      },
    };
  },
});

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(value);
}

/** Header status: when each source last landed data in Convex. */
export const sourceStatus = authenticatedQuery({
  args: {},
  returns: v.array(
    v.object({
      source: v.string(),
      status: v.string(),
      message: v.union(v.string(), v.null()),
      lastSuccessAt: nullableNumber,
    }),
  ),
  handler: async ctx => {
    const rows = await ctx.db.query("syncState").collect();
    return rows.map(row => ({
      source: row.source,
      status: row.status,
      message: row.message ?? null,
      lastSuccessAt: row.lastSuccessAt ?? null,
    }));
  },
});
