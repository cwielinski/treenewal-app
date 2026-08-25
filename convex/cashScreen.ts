import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import { matchesSegment, type SegmentFilter } from "./backlog";
import { type PeriodKey, periodRange, todayInCentral } from "./periods";

/**
 * Cash.
 *
 * Receivables, days to payment and payment behaviour come from the ArboStar
 * invoice mirror, which carries every payment against every invoice. Cash on
 * hand, cash out, payroll, bills coming due and debt service are QuickBooks
 * figures and stay blank until QuickBooks is connected. Nothing here is
 * estimated or filled in from a substitute source.
 */

/** Invoices are treated as due on issue unless TreeNewal says otherwise. */
const TERMS_DAYS = 30;
/** Open balances below this are rounding residue, not receivables. */
const RESIDUAL_LIMIT = 25;

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

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
  );
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, m - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

/** The date an invoice was fully settled, or undefined if it is still open. */
function settledOn(invoice: Doc<"invoices">): string | undefined {
  if (!invoice.isPaid) return undefined;
  const dates = invoice.payments.map(payment => payment.date).filter(Boolean).sort();
  return dates.length > 0 ? dates[dates.length - 1] : undefined;
}

export const cash = authenticatedQuery({
  args: {
    period: periodArg,
    line: lineArg,
    segment: v.optional(
      v.union(
        v.literal("all"),
        v.literal("exclude_government"),
        v.literal("government"),
      ),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { period, line, segment: segmentArgValue }) => {
    // Government retainage is held for years, so it can be filtered out of
    // receivables without hiding it from the rest of the business.
    const segment: SegmentFilter = segmentArgValue ?? "all";
    await requireScreen(ctx, "cash");

    const now = Date.now();
    const today = todayInCentral(now);
    const range = periodRange(period as PeriodKey, now);

    const invoices = (await ctx.db.query("invoices").collect()).filter(
      invoice =>
        !invoice.excluded &&
        matchesLine(invoice.serviceLine, line) &&
        matchesSegment(invoice.segment, segment),
    );

    // ---- owed to us, aged from the invoice date
    const open = invoices.filter(invoice => !invoice.isPaid && invoice.due > 0.5);
    const buckets = [
      { label: "Current", count: 0, value: 0 },
      { label: "1 to 30 days", count: 0, value: 0 },
      { label: "31 to 60 days", count: 0, value: 0 },
      { label: "Over 60 days", count: 0, value: 0 },
    ];
    for (const invoice of open) {
      // Aged by days past due, the standard reading, so "current" means
      // inside terms rather than issued today.
      const pastDue = daysBetween(invoice.date, today) - TERMS_DAYS;
      const bucket =
        pastDue <= 0
          ? buckets[0]
          : pastDue <= 30
            ? buckets[1]
            : pastDue <= 60
              ? buckets[2]
              : buckets[3];
      bucket.count += 1;
      bucket.value += invoice.due;
    }

    const overdue = open
      .map(invoice => ({
        client: invoice.clientName ?? "Customer",
        number: invoice.number,
        amount: Math.round(invoice.due),
        days: daysBetween(invoice.date, today),
        serviceLine: effectiveLine(invoice.serviceLine),
        invoiced: invoice.date,
      }))
      .filter(row => row.days > TERMS_DAYS)
      .sort((a, b) => b.amount - a.amount);

    // Hundreds of open invoices are rounding residue of a few dollars. They
    // are counted in the total, because that is what ArboStar says is owed,
    // but they are named so nobody reads them as money to chase.
    const residual = open.filter(invoice => invoice.due < RESIDUAL_LIMIT);

    const topOverdue = overdue.slice(0, 5);
    const restOverdue = overdue.slice(5);

    // ---- how long customers take to pay, by month settled
    const monthTotals = new Map<string, { days: number; count: number }>();
    let paidInPeriod = 0;
    let paidWithinTerms = 0;
    for (const invoice of invoices) {
      const settled = settledOn(invoice);
      if (settled === undefined) continue;
      const days = Math.max(0, daysBetween(invoice.date, settled));
      const key = monthKey(settled);
      const row = monthTotals.get(key) ?? { days: 0, count: 0 };
      row.days += days;
      row.count += 1;
      monthTotals.set(key, row);
      if (settled >= range.start && settled <= range.end) {
        paidInPeriod += 1;
        if (days <= TERMS_DAYS) paidWithinTerms += 1;
      }
    }

    const currentMonth = monthKey(today);
    const daysToPayment: { month: string; days: number | null }[] = [];
    for (let back = 11; back >= 0; back--) {
      const month = shiftMonths(currentMonth, -back);
      const row = monthTotals.get(month);
      daysToPayment.push({
        month,
        days: row && row.count > 0 ? Math.round(row.days / row.count) : null,
      });
    }

    // ---- cash actually collected in the period, from invoice payments
    let collected = 0;
    for (const invoice of invoices) {
      for (const payment of invoice.payments) {
        if (payment.date >= range.start && payment.date <= range.end) {
          collected += payment.amount;
        }
      }
    }

    const financeRow = await ctx.db
      .query("finance")
      .withIndex("by_periodKey_and_line", q =>
        q.eq("periodKey", period).eq("line", "all"),
      )
      .unique();

    const syncRows = await ctx.db.query("syncState").collect();
    const quickbooks = syncRows.find(row => row.source === "quickbooks");

    return {
      range,
      period,
      line,
      termsDays: TERMS_DAYS,
      collected: Math.round(collected),
      receivables: {
        total: Math.round(open.reduce((sum, invoice) => sum + invoice.due, 0)),
        count: open.length,
        buckets: buckets.map(bucket => ({
          label: bucket.label,
          count: bucket.count,
          value: Math.round(bucket.value),
        })),
        topOverdue,
        residual: {
          count: residual.length,
          value: Math.round(residual.reduce((sum, invoice) => sum + invoice.due, 0)),
          limit: RESIDUAL_LIMIT,
        },
        moreOverdue: {
          count: restOverdue.length,
          value: restOverdue.reduce((sum, row) => sum + row.amount, 0),
        },
      },
      payment: {
        daysToPayment,
        latest: daysToPayment[daysToPayment.length - 1]?.days ?? null,
        earliest: daysToPayment.find(point => point.days !== null) ?? null,
        paidWithinTermsShare:
          paidInPeriod > 0 ? Math.round((paidWithinTerms / paidInPeriod) * 100) : null,
        paidInPeriod,
      },
      // QuickBooks only. Left null rather than estimated from anything else.
      quickbooks: {
        status: quickbooks?.status ?? "unavailable",
        message: quickbooks?.message ?? null,
        cashOnHand: null as number | null,
        cashOut:
          financeRow?.operatingExpenses !== undefined &&
          financeRow?.payroll !== undefined
            ? Math.round(
                (financeRow.operatingExpenses ?? 0) +
                  (financeRow.payroll ?? 0) +
                  (financeRow.debtService ?? 0),
              )
            : null,
        payroll: financeRow?.payroll ?? null,
        payrollTrailing: null as number | null,
        operatingExpenses: financeRow?.operatingExpenses ?? null,
        debtService: financeRow?.debtService ?? null,
        cashCollected: financeRow?.cashCollected ?? null,
      },
    };
  },
});
