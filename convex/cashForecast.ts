import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import { shiftDays } from "./backlog";
import { todayInCentral } from "./periods";

/**
 * Thirteen week cash forecast.
 *
 * Every figure here is built from what TreeNewal has already done, not from
 * a budget or a guess:
 *
 *   Money in  = the open ArboStar receivable, aged and run through the
 *               payment timing TreeNewal actually gets, plus the work the
 *               crews are expected to invoice over the next thirteen weeks
 *               at the recent invoicing rate, collected on the same curve.
 *   Money out = the trailing twelve month run rate from QuickBooks, split
 *               into payroll, other job cost, operating cost and debt
 *               service so a reader can see what is driving the week.
 *
 * The cost side is a steady weekly rate. Real payroll lands fortnightly and
 * real bills land lumpy, so a single week is less reliable than the shape of
 * the thirteen. The screen says that rather than implying precision.
 */

const WEEKS = 13;
/** Open balances below this are rounding residue, not receivables. */
const RESIDUAL_LIMIT = 25;
/** Weeks of invoicing history used for the payment timing curve. */
const CURVE_DAYS = 365;
/** Weeks of invoicing history used for the invoicing run rate. */
const RUN_RATE_WEEKS = 26;

type Curve = {
  /** Share of a dollar collected in week 0..12 after the invoice date. */
  buckets: number[];
  /** Share collected at all, within the window. */
  collected: number;
};

function weeksBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const days =
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000;
  return Math.floor(days / 7);
}

/** Monday of the week a date falls in. */
function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return shiftDays(date, -back);
}

/**
 * How TreeNewal actually gets paid. Each payment in the last year is placed
 * in the week it arrived relative to its invoice date, weighted by amount.
 */
function paymentCurve(invoices: Doc<"invoices">[], today: string): Curve {
  const from = shiftDays(today, -CURVE_DAYS);
  const buckets = new Array<number>(WEEKS).fill(0);
  let invoiced = 0;
  let collectedInWindow = 0;
  for (const invoice of invoices) {
    if (invoice.excluded) continue;
    if (invoice.date < from || invoice.date > today) continue;
    invoiced += invoice.total;
    for (const payment of invoice.payments) {
      const week = weeksBetween(invoice.date, payment.date);
      if (week < 0 || week >= WEEKS) continue;
      buckets[week] += payment.amount;
      collectedInWindow += payment.amount;
    }
  }
  if (collectedInWindow <= 0 || invoiced <= 0) {
    // No history to read. Fall back to a flat two week lag rather than
    // pretending to a curve.
    const flat = new Array<number>(WEEKS).fill(0);
    flat[2] = 1;
    return { buckets: flat, collected: 1 };
  }
  return {
    buckets: buckets.map(amount => amount / collectedInWindow),
    collected: Math.min(1, collectedInWindow / invoiced),
  };
}

/**
 * Seasonal index by calendar month, from the last two years of invoicing.
 * Tree work in Dallas is not flat: without this the quarter ahead is read at
 * an August rate, which flatters November and December.
 */
function seasonalIndex(
  invoices: Doc<"invoices">[],
  today: string,
): Map<number, number> {
  const from = shiftDays(today, -730);
  const byMonth = new Map<number, { total: number; years: Set<string> }>();
  for (const invoice of invoices) {
    if (invoice.excluded) continue;
    if (invoice.date < from || invoice.date > today) continue;
    const month = Number(invoice.date.slice(5, 7));
    const entry = byMonth.get(month) ?? { total: 0, years: new Set<string>() };
    entry.total += invoice.total;
    entry.years.add(invoice.date.slice(0, 4));
    byMonth.set(month, entry);
  }
  const rates = new Map<number, number>();
  for (const [month, entry] of byMonth) {
    rates.set(month, entry.total / Math.max(1, entry.years.size));
  }
  const values = [...rates.values()];
  const average = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const index = new Map<number, number>();
  if (average <= 0) return index;
  for (const [month, rate] of rates) {
    // Held inside a sane band. A single odd month should tilt the forecast,
    // not take it over.
    index.set(month, Math.min(1.4, Math.max(0.6, rate / average)));
  }
  return index;
}

/** Weekly invoicing over the recent past, tax included, consultations in. */
function invoicingRunRate(invoices: Doc<"invoices">[], today: string): number {
  const from = shiftDays(today, -RUN_RATE_WEEKS * 7);
  let total = 0;
  for (const invoice of invoices) {
    if (invoice.excluded) continue;
    if (invoice.date <= from || invoice.date > today) continue;
    total += invoice.total;
  }
  return total / RUN_RATE_WEEKS;
}

export const forecast = authenticatedQuery({
  args: {},
  returns: v.object({
    generatedFor: v.string(),
    openingCash: v.union(v.number(), v.null()),
    openReceivable: v.number(),
    weeklyInvoicing: v.number(),
    seasonalLow: v.number(),
    lowestBalance: v.union(v.number(), v.null()),
    lowestWeek: v.union(v.string(), v.null()),
    costs: v.object({
      payroll: v.number(),
      jobCost: v.number(),
      operating: v.number(),
      debtService: v.number(),
    }),
    weeks: v.array(
      v.object({
        start: v.string(),
        fromReceivables: v.number(),
        fromNewWork: v.number(),
        moneyOut: v.number(),
        net: v.number(),
        closing: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async ctx => {
    await requireScreen(ctx, "cash");
    const today = todayInCentral();
    const invoices = await ctx.db.query("invoices").collect();
    const finance = await ctx.db
      .query("finance")
      .withIndex("by_periodKey_and_line", q =>
        q.eq("periodKey", "ttm").eq("line", "all"),
      )
      .unique();

    const curve = paymentCurve(invoices, today);
    const baseInvoicing = invoicingRunRate(invoices, today);
    const season = seasonalIndex(invoices, today);

    // Money out, as a weekly rate from the trailing twelve months. Payroll is
    // held apart because it is the largest and the least flexible. Job cost is
    // cost of goods sold with the crew wages already inside payroll removed.
    // Operating is everything else in expenses, again less the payroll and the
    // debt service that are shown on their own lines.
    const revenue = finance?.revenue;
    const grossProfit = finance?.grossProfit;
    const cogs =
      revenue !== undefined && grossProfit !== undefined
        ? revenue - grossProfit
        : undefined;
    const payrollYear = finance?.payroll ?? 0;
    const fieldLabor = finance?.fieldLabor ?? 0;
    const overheadPayroll = finance?.overheadPayroll ?? 0;
    const debtYear = finance?.debtService ?? 0;
    const expensesYear = finance?.operatingExpenses ?? 0;
    const costs = {
      payroll: payrollYear / 52,
      jobCost: Math.max(0, (cogs ?? 0) - fieldLabor) / 52,
      operating:
        Math.max(0, expensesYear - overheadPayroll - debtYear) / 52,
      debtService: debtYear / 52,
    };
    const moneyOut =
      costs.payroll + costs.jobCost + costs.operating + costs.debtService;

    const firstWeek = weekStart(today);
    const weekStarts = Array.from({ length: WEEKS }, (_, index) =>
      shiftDays(firstWeek, index * 7),
    );

    // Money in from what is already invoiced and still open. An invoice that
    // is already three weeks old can only be paid in the part of the curve
    // that is still ahead of it, so the curve is conditioned on its age.
    const fromReceivables = new Array<number>(WEEKS).fill(0);
    let openReceivable = 0;
    for (const invoice of invoices) {
      if (invoice.excluded || invoice.isPaid) continue;
      if (invoice.due <= RESIDUAL_LIMIT) continue;
      if (invoice.date > today) continue;
      openReceivable += invoice.due;
      const age = Math.max(0, weeksBetween(invoice.date, today));
      let ahead = 0;
      for (let week = age; week < WEEKS; week += 1) ahead += curve.buckets[week];
      if (ahead <= 0) {
        // Older than the curve reaches. These do still come in, so they are
        // spread evenly across the quarter at the collected share rather than
        // being written off or counted in full.
        const each = (invoice.due * curve.collected) / WEEKS;
        for (let week = 0; week < WEEKS; week += 1) fromReceivables[week] += each;
        continue;
      }
      for (let week = age; week < WEEKS; week += 1) {
        const share = curve.buckets[week] / ahead;
        fromReceivables[week - age] += invoice.due * share * curve.collected;
      }
    }

    // Money in from work not invoiced yet. The crews keep invoicing at the
    // recent rate and that new paper is collected on the same curve.
    const fromNewWork = new Array<number>(WEEKS).fill(0);
    // The recent rate is the starting point, tilted by how each calendar
    // month has actually run over the last two years.
    // The base rate is itself an average of the months it spans, so it is
    // deseasonalised against those months rather than against the current
    // one. Dividing by a single month double counts the tilt.
    let windowIndex = 0;
    for (let back = 1; back <= RUN_RATE_WEEKS; back += 1) {
      const day = shiftDays(today, -back * 7);
      windowIndex += season.get(Number(day.slice(5, 7))) ?? 1;
    }
    windowIndex = windowIndex / RUN_RATE_WEEKS || 1;
    const weeklyInvoicing = weekStarts.map(start => {
      const ahead = season.get(Number(start.slice(5, 7))) ?? 1;
      const tilt = Math.min(1.25, Math.max(0.75, ahead / windowIndex));
      return baseInvoicing * tilt;
    });
    for (let issued = 0; issued < WEEKS; issued += 1) {
      for (let lag = 0; lag + issued < WEEKS; lag += 1) {
        fromNewWork[issued + lag] +=
          weeklyInvoicing[issued] * curve.buckets[lag] * curve.collected;
      }
    }

    const openingCash =
      finance?.cashOnHand === undefined
        ? null
        : finance.cashOnHand + (finance.undepositedFunds ?? 0);

    let running = openingCash;
    let lowestBalance: number | null = null;
    let lowestWeek: string | null = null;
    const weeks = weekStarts.map((start, index) => {
      const inflow = fromReceivables[index] + fromNewWork[index];
      const net = inflow - moneyOut;
      running = running === null ? null : running + net;
      if (running !== null && (lowestBalance === null || running < lowestBalance)) {
        lowestBalance = running;
        lowestWeek = start;
      }
      return {
        start,
        fromReceivables: Math.round(fromReceivables[index]),
        fromNewWork: Math.round(fromNewWork[index]),
        moneyOut: Math.round(moneyOut),
        net: Math.round(net),
        closing: running === null ? null : Math.round(running),
      };
    });

    return {
      generatedFor: today,
      openingCash: openingCash === null ? null : Math.round(openingCash),
      openReceivable: Math.round(openReceivable),
      weeklyInvoicing: Math.round(weeklyInvoicing[0]),
      seasonalLow: Math.round(Math.min(...weeklyInvoicing)),
      lowestBalance: lowestBalance === null ? null : Math.round(lowestBalance),
      lowestWeek,
      costs: {
        payroll: Math.round(costs.payroll),
        jobCost: Math.round(costs.jobCost),
        operating: Math.round(costs.operating),
        debtService: Math.round(costs.debtService),
      },
      weeks,
    };
  },
});
