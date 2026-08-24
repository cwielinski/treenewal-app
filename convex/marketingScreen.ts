import { v } from "convex/values";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import { type PeriodKey, periodRange, todayInCentral } from "./periods";

/**
 * Marketing.
 *
 * ArboStar lead source is NOT used here. Chris concluded on 2026-08-24 that
 * intake attribution is unreliable: customers do not reliably know how they
 * found TreeNewal, and ArboStar disagrees with WhatConverts. So the channel
 * table, the raw source table and the acquisition versus relationship split
 * were all removed rather than shown with a caveat.
 *
 * What is left is trustworthy: lead, estimate and job COUNTS from ArboStar,
 * which are volume rather than attribution, revenue from invoices, and
 * spend with every cost ratio from the leads sheet Chris maintains by hand.
 */

const lineArg = v.union(v.literal("all"), v.literal("production"), v.literal("phc"));
const periodArg = v.union(
  v.literal("mtd"),
  v.literal("last_month"),
  v.literal("qtd"),
  v.literal("ytd"),
  v.literal("ttm"),
);

type Line = "all" | "production" | "phc";

function effectiveLine(recordLine: string | undefined): "production" | "phc" {
  return recordLine === "phc" ? "phc" : "production";
}

function matchesLine(recordLine: string | undefined, line: Line): boolean {
  if (line === "all") return true;
  return effectiveLine(recordLine) === line;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export const marketing = authenticatedQuery({
  args: { period: periodArg, line: lineArg },
  returns: v.any(),
  handler: async (ctx, { period, line }) => {
    await requireScreen(ctx, "marketing");

    const now = Date.now();
    const today = todayInCentral(now);
    const range = periodRange(period as PeriodKey, now);

    // Reads are kept inside index ranges: the tables together run to tens of
    // thousands of rows, which is past what one Convex query may read.
    const trendStart = `${shiftMonths(monthKey(today), -11)}-01`;
    const historyStart = trendStart < range.start ? trendStart : range.start;

    const jobs = await ctx.db.query("jobs").collect();
    const invoices = (
      await ctx.db
        .query("invoices")
        .withIndex("by_date", q =>
          q.gte("date", historyStart).lte("date", range.end > today ? range.end : today),
        )
        .collect()
    ).filter(invoice => !invoice.excluded && !invoice.consultation);
    const estimates = await ctx.db
      .query("estimates")
      .withIndex("by_createdAt", q =>
        q.gte("createdAt", range.start).lte("createdAt", range.end),
      )
      .collect();
    const periodLeadRows = await ctx.db
      .query("leads")
      .withIndex("by_createdAt", q =>
        q.gte("createdAt", range.start).lte("createdAt", range.end),
      )
      .collect();

    // ---- the funnel for the period
    const periodLeads = periodLeadRows;
    const periodEstimates = estimates.filter(estimate =>
      matchesLine(estimate.serviceLine, line),
    );
    const periodJobs = jobs.filter(
      job =>
        job.createdAt >= range.start &&
        job.createdAt <= range.end &&
        matchesLine(job.serviceLine, line),
    );

    // ---- revenue closed in the period, attributed through the work order
    const periodInvoices = invoices.filter(
      invoice =>
        invoice.date >= range.start &&
        invoice.date <= range.end &&
        matchesLine(invoice.serviceLine, line),
    );

    // ---- twelve month trend of revenue closed, by month
    const currentMonth = monthKey(today);
    const monthTotals = new Map<string, number>();
    for (const invoice of invoices) {
      if (!matchesLine(invoice.serviceLine, line)) continue;
      monthTotals.set(
        monthKey(invoice.date),
        (monthTotals.get(monthKey(invoice.date)) ?? 0) + invoice.valueExTax,
      );
    }
    const trend: { month: string; revenue: number }[] = [];
    for (let back = 11; back >= 0; back--) {
      const month = shiftMonths(currentMonth, -back);
      trend.push({ month, revenue: Math.round(monthTotals.get(month) ?? 0) });
    }

    // ---- the leads sheet: media cost by month and channel
    const months: string[] = [];
    {
      let cursor = monthKey(range.start);
      const last = monthKey(range.end);
      while (cursor <= last && months.length < 24) {
        months.push(cursor);
        cursor = shiftMonths(cursor, 1);
      }
    }
    const spendRows = await ctx.db.query("leadSpend").collect();
    // A month with no leads recorded has not been filled in yet. Its cost
    // cell still carries a standing figure, so the whole month is left out
    // rather than reported as spend with no leads behind it.
    const filledMonths = new Set(
      spendRows
        .filter(row => row.channel === "total" && (row.leads ?? 0) > 0)
        .map(row => row.month),
    );
    const inPeriod = spendRows.filter(
      row => months.includes(row.month) && filledMonths.has(row.month),
    );
    const channelTotals = (channel: string) => {
      const rows = inPeriod.filter(row => row.channel === channel);
      const sum = (pick: (row: (typeof rows)[number]) => number | undefined) =>
        rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
      const leadsTotal = sum(row => row.leads);
      const cost = sum(row => row.cost);
      const sales = sum(row => row.sales);
      const revenue = sum(row => row.revenue);
      return {
        leads: leadsTotal,
        cost: Math.round(cost),
        sales,
        revenue: Math.round(revenue),
        costPerLead: leadsTotal > 0 ? Math.round(cost / leadsTotal) : null,
        costPerSale: sales > 0 ? Math.round(cost / sales) : null,
        returnOnSpend: cost > 0 ? round(revenue / cost, 1) : null,
      };
    };
    const missingMonths = months.filter(month => !filledMonths.has(month));

    const syncRows = await ctx.db.query("syncState").collect();
    const leadSync = syncRows.find(row => row.source === "arbostar_leads");

    const totalRevenue = Math.round(
      periodInvoices.reduce((sum, invoice) => sum + invoice.valueExTax, 0),
    );

    return {
      range,
      period,
      line,
      leadsSynced: leadSync?.recordCount ?? 0,
      funnel: {
        leads: periodLeads.length,
        estimates: periodEstimates.length,
        sold: periodJobs.length,
        leadToEstimate:
          periodLeads.length > 0
            ? round((periodEstimates.length / periodLeads.length) * 100, 1)
            : null,
        closeRate:
          periodEstimates.length > 0
            ? round((periodJobs.length / periodEstimates.length) * 100, 1)
            : null,
        leadToSale:
          periodLeads.length > 0
            ? round((periodJobs.length / periodLeads.length) * 100, 1)
            : null,
      },
      averageJobValue: {
        blended:
          periodInvoices.length > 0
            ? Math.round(totalRevenue / periodInvoices.length)
            : null,
        jobs: periodInvoices.length,
      },
      totalRevenue,
      trend,
      // From the leads sheet. Paid Ads combines Google Ads and Local
      // Services Ads, and SEO carries a cost of its own. Return on spend
      // divides paid media revenue by paid spend only.
      spend: {
        months,
        missingMonths,
        paid: channelTotals("paid"),
        seo: channelTotals("seo"),
        total: channelTotals("total"),
      },
    };
  },
});
