import { v } from "convex/values";
import { CATEGORY_ORDER, categorize, isPaidCategory } from "./leadCategories";
import type { Doc } from "./_generated/dataModel";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import { type PeriodKey, periodRange, todayInCentral } from "./periods";

/**
 * Marketing.
 *
 * Attribution follows the lead source recorded at intake, so every figure
 * here reflects first contact rather than every touch. A sold job is
 * attributed to the most recent lead its customer raised on or before the
 * day the job was sold.
 *
 * Spend, cost per lead, cost per sale and return on ad spend need Google
 * Ads. Until that is connected they read as pending rather than as zero.
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

/**
 * Relationship sources are the ones TreeNewal does not buy: referrals and
 * repeat customers. Everything else is acquisition.
 */
function isRelationship(source: string): boolean {
  const name = source.toLowerCase();
  return name.includes("referral") || name.includes("repeat") || name.includes("refer");
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

    const jobById = new Map<number, Doc<"jobs">>();
    for (const job of jobs) jobById.set(job.arboId, job);

    // ---- the intake source of each customer, over time. Only the customers
    // that appear in this period are looked up, one indexed read each.
    const clientIds = new Set<number>();
    for (const job of jobs) {
      if (
        job.clientId !== undefined &&
        job.createdAt >= range.start &&
        job.createdAt <= range.end
      ) {
        clientIds.add(job.clientId);
      }
    }
    for (const invoice of invoices) {
      if (invoice.date < range.start || invoice.date > range.end) continue;
      const job =
        invoice.workOrderId === undefined
          ? undefined
          : jobById.get(invoice.workOrderId);
      if (job?.clientId !== undefined) clientIds.add(job.clientId);
    }

    const leadsByClient = new Map<number, Doc<"leads">[]>();
    for (const clientId of clientIds) {
      const list = await ctx.db
        .query("leads")
        .withIndex("by_clientId", q => q.eq("clientId", clientId))
        .collect();
      list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      leadsByClient.set(clientId, list);
    }

    const sourceFor = (clientId: number | undefined, asOf: string): string => {
      if (clientId === undefined) return "Not recorded";
      const list = leadsByClient.get(clientId);
      if (!list || list.length === 0) return "Not recorded";
      let chosen = list[0];
      for (const lead of list) {
        if (lead.createdAt <= asOf) chosen = lead;
        else break;
      }
      return chosen.source;
    };

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

    type Row = { leads: number; sold: number; revenue: number };
    const bySource = new Map<string, Row>();
    const bump = (source: string, patch: Partial<Row>) => {
      const row = bySource.get(source) ?? { leads: 0, sold: 0, revenue: 0 };
      row.leads += patch.leads ?? 0;
      row.sold += patch.sold ?? 0;
      row.revenue += patch.revenue ?? 0;
      bySource.set(source, row);
    };

    for (const lead of periodLeads) bump(lead.source, { leads: 1 });
    for (const job of periodJobs) {
      bump(sourceFor(job.clientId, job.createdAt), { sold: 1 });
    }
    for (const invoice of periodInvoices) {
      const job =
        invoice.workOrderId === undefined
          ? undefined
          : jobById.get(invoice.workOrderId);
      bump(sourceFor(job?.clientId, invoice.date), {
        revenue: invoice.valueExTax,
      });
    }

    // Grouped into channels, so Wes reads demand by channel rather than by
    // data entry habit. The raw source rows stay available underneath.
    const byCategory = new Map<string, Row>();
    for (const [source, row] of bySource.entries()) {
      const key = categorize(source);
      const current = byCategory.get(key) ?? { leads: 0, sold: 0, revenue: 0 };
      current.leads += row.leads;
      current.sold += row.sold;
      current.revenue += row.revenue;
      byCategory.set(key, current);
    }
    const categories = CATEGORY_ORDER.filter(name => byCategory.has(name)).map(
      name => {
        const row = byCategory.get(name)!;
        return {
          category: name,
          leads: row.leads,
          sold: row.sold,
          leadToSale: row.leads > 0 ? round((row.sold / row.leads) * 100, 1) : null,
          revenue: Math.round(row.revenue),
          paid: isPaidCategory(name),
        };
      },
    );

    const sources = [...bySource.entries()]
      .map(([source, row]) => ({
        source,
        category: categorize(source),
        leads: row.leads,
        sold: row.sold,
        leadToSale: row.leads > 0 ? round((row.sold / row.leads) * 100, 1) : null,
        revenue: Math.round(row.revenue),
        // Cost per sale needs media cost, which only Google Ads can supply.
        costPerSale: null as number | null,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // ---- average job value, relationship sources against the rest
    let relationshipValue = 0;
    let relationshipJobs = 0;
    let acquisitionValue = 0;
    let acquisitionJobs = 0;
    for (const invoice of periodInvoices) {
      const job =
        invoice.workOrderId === undefined
          ? undefined
          : jobById.get(invoice.workOrderId);
      const source = sourceFor(job?.clientId, invoice.date);
      if (isRelationship(source)) {
        relationshipValue += invoice.valueExTax;
        relationshipJobs += 1;
      } else {
        acquisitionValue += invoice.valueExTax;
        acquisitionJobs += 1;
      }
    }

    // ---- twelve month trend of revenue attributed, by month closed
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
        acquisition:
          acquisitionJobs > 0 ? Math.round(acquisitionValue / acquisitionJobs) : null,
        relationship:
          relationshipJobs > 0
            ? Math.round(relationshipValue / relationshipJobs)
            : null,
      },
      totalRevenue,
      sources,
      categories,
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
