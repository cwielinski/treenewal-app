import { v } from "convex/values";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import {
  BACKLOG_MAX_AGE_DAYS,
  RUN_RATE_WEEKS,
  TARGET_BAND,
  backlogAt,
  backlogInputs,
  effectiveLine,
  type Line,
  matchesLine,
  matchesSegment,
  type SegmentFilter,
  shiftDays,
} from "./backlog";
import { deliveredTypes, isDeadStatus, scheduledMonthFromStatus } from "./serviceLine";

const lineArg = v.union(v.literal("all"), v.literal("production"), v.literal("phc"));
const segmentArg = v.union(
  v.literal("all"),
  v.literal("exclude_government"),
  v.literal("government"),
);
/**
 * Open estimates age off after this, because a proposal nobody has answered
 * in half a year is not pipeline. Government awards have no cutoff: they
 * are routinely approved a year or two after they are issued.
 */
const OPEN_ESTIMATE_MAX_AGE_DAYS = 180;
const periodArg = v.union(
  v.literal("mtd"),
  v.literal("last_month"),
  v.literal("qtd"),
  v.literal("ytd"),
  v.literal("ttm"),
);

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
import { type PeriodKey, periodRange, todayInCentral } from "./periods";

/**
 * Jobs and Backlog.
 *
 * Backlog is sold work that has not been invoiced yet, divided by the
 * weekly invoiced run rate, and is always read against the 2.5 to 3 week
 * target band. Using the invoice as the closing signal means a work order
 * leaves the backlog on the same date QuickBooks bills it, so the two
 * systems agree and stale open statuses cannot inflate the number.
 *
 * The city rows and the job mix read the same closed job set as the
 * Overview and the Map, so all of them reconcile by construction.
 */

export const jobs = authenticatedQuery({
  args: {
    period: periodArg,
    line: lineArg,
    segment: v.optional(segmentArg),
  },
  returns: v.any(),
  handler: async (ctx, { period, line, segment: segmentArgValue }) => {
    const segment: SegmentFilter = segmentArgValue ?? "all";
    await requireScreen(ctx, "jobs");

    const now = Date.now();
    const today = todayInCentral(now);
    const range = periodRange(period as PeriodKey, now);

    // ---- backlog now, and the twenty six week history behind it
    const inputs = await backlogInputs(ctx);
    const current = backlogAt(inputs, today, line, segment);
    const production = backlogAt(inputs, today, "production", segment);
    const phc = backlogAt(inputs, today, "phc", segment);

    const series: { date: string; weeks: number | null }[] = [];
    for (let week = RUN_RATE_WEEKS; week >= 0; week--) {
      const date = shiftDays(today, -week * 7);
      series.push({ date, weeks: backlogAt(inputs, date, line, segment).weeks });
    }

    // Weeks of coverage translated into a date the sold work runs out.
    const runsOut =
      current.weeks !== null && current.weeks > 0
        ? shiftDays(today, Math.round(current.weeks * 7))
        : null;

    // ---- the closed job set for this period. Same set as Overview and Map.
    const closedAll = (
      await ctx.db
        .query("invoices")
        .withIndex("by_date", q => q.gte("date", range.start).lte("date", range.end))
        .collect()
    ).filter(
      inv =>
        !inv.excluded &&
        matchesLine(inv.serviceLine, line) &&
        matchesSegment(inv.segment, segment),
    );
    const closed = closedAll.filter(inv => !inv.consultation);

    // ---- where the work is coming from. Demand only, never a financial split.
    const cityTotals = new Map<string, { jobs: number; value: number }>();
    for (const invoice of closed) {
      const city = (invoice.city ?? "").trim();
      if (city.length === 0) continue;
      const row = cityTotals.get(city) ?? { jobs: 0, value: 0 };
      row.jobs += 1;
      row.value += invoice.valueExTax;
      cityTotals.set(city, row);
    }
    const cities = [...cityTotals.entries()]
      .map(([city, row]) => ({
        city,
        jobs: row.jobs,
        averageJobValue: Math.round(row.value / row.jobs),
      }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 8);

    // ---- job mix and value, by service type from the ArboStar catalogue
    const typeTotals = new Map<
      string,
      { jobs: number; revenue: number; line: "production" | "phc" }
    >();
    for (const invoice of closed) {
      for (const type of deliveredTypes(invoice)) {
        if (!matchesLine(type.line, line)) continue;
        const row = typeTotals.get(type.name) ?? {
          jobs: 0,
          revenue: 0,
          line: effectiveLine(type.line),
        };
        row.jobs += 1;
        row.revenue += type.amount;
        typeTotals.set(type.name, row);
      }
    }
    const jobMix = [...typeTotals.entries()]
      .map(([name, row]) => ({
        name,
        serviceLine: row.line,
        jobs: row.jobs,
        revenue: Math.round(row.revenue),
        averageJobValue: Math.round(row.revenue / row.jobs),
        // Margin by service type needs job level cost. ArboStar does not
        // carry it, so this stays null until QuickBooks fills it in at the
        // service line level.
        margin: null as number | null,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 12);

    // ---- the schedule ahead. ArboStar carries no scheduled date and no man
    // hours on a work order, but Plant Health Care parks each sold job in a
    // status that names its treatment month, so that book of work is real.
    const monthTotals = new Map<string, { jobs: number; value: number }>();
    let unscheduledValue = 0;
    let unscheduledJobs = 0;
    const staleBefore = shiftDays(today, -BACKLOG_MAX_AGE_DAYS);
    for (const job of inputs.jobs) {
      if (job.createdAt < staleBefore) continue;
      if (isDeadStatus(job.statusName)) continue;
      if (!matchesLine(job.serviceLine, line)) continue;
      if (!matchesSegment(job.segment, segment)) continue;
      if (inputs.closedOn.has(job.arboId)) continue;
      const month = scheduledMonthFromStatus(job.statusName);
      if (month === undefined || month < today.slice(0, 7)) {
        unscheduledValue += job.value;
        unscheduledJobs += 1;
        continue;
      }
      const row = monthTotals.get(month) ?? { jobs: 0, value: 0 };
      row.jobs += 1;
      row.value += job.value;
      monthTotals.set(month, row);
    }
    const scheduleAhead = {
      months: [...monthTotals.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(0, 8)
        .map(([month, row]) => ({
          month,
          jobs: row.jobs,
          value: Math.round(row.value),
        })),
      unscheduledJobs,
      unscheduledValue: Math.round(unscheduledValue),
    };

    // ---- open estimates, aged from the day they were issued
    const estimateAgeFloor = shiftDays(today, -OPEN_ESTIMATE_MAX_AGE_DAYS);
    const openEstimates = (
      await ctx.db
        .query("estimates")
        .withIndex("by_createdAt", q => q.lte("createdAt", today))
        .collect()
    ).filter(
      estimate =>
        estimate.open &&
        matchesLine(estimate.serviceLine, line) &&
        matchesSegment(estimate.segment, segment) &&
        (estimate.segment === "government" ||
          estimate.createdAt >= estimateAgeFloor),
    );

    const ageDays = (date: string) =>
      Math.max(
        0,
        Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
            86400000,
        ),
      );

    const bucketOf = (days: number) =>
      days <= 7 ? "0-7" : days <= 30 ? "8-30" : "30+";
    const buckets: Record<string, { count: number; value: number }> = {
      "0-7": { count: 0, value: 0 },
      "8-30": { count: 0, value: 0 },
      "30+": { count: 0, value: 0 },
    };
    for (const estimate of openEstimates) {
      const bucket = buckets[bucketOf(ageDays(estimate.createdAt))];
      bucket.count += 1;
      bucket.value += estimate.valueExTax;
    }

    const largestOpen = openEstimates
      .slice()
      .sort((a, b) => b.valueExTax - a.valueExTax)
      .slice(0, 5)
      .map(estimate => ({
        name: estimate.topItem ?? "Estimate",
        city: estimate.city ?? "",
        value: Math.round(estimate.valueExTax),
        days: ageDays(estimate.createdAt),
        serviceLine: effectiveLine(estimate.serviceLine),
      }));

    // ---- proposal value won: dollars won over dollars proposed.
    // Distinct from close rate, which is jobs sold over estimates issued.
    const periodEstimates = (
      await ctx.db
        .query("estimates")
        .withIndex("by_createdAt", q =>
          q.gte("createdAt", range.start).lte("createdAt", range.end),
        )
        .collect()
    ).filter(estimate => matchesSegment(estimate.segment, segment));
    const proposalValueWonFor = (which: Line) => {
      const subset = periodEstimates.filter(estimate =>
        matchesLine(estimate.serviceLine, which),
      );
      const proposed = sum(subset.map(estimate => estimate.valueExTax));
      const won = sum(
        subset.filter(estimate => estimate.sold).map(estimate => estimate.valueExTax),
      );
      return proposed > 0 ? round((won / proposed) * 100, 1) : null;
    };

    // ---- who the work is for. Counts and value only, never a margin split.
    const segmentTotals = new Map<string, { jobs: number; value: number }>();
    for (const invoice of closed) {
      const key = invoice.segment ?? "unknown";
      const row = segmentTotals.get(key) ?? { jobs: 0, value: 0 };
      row.jobs += 1;
      row.value += invoice.valueExTax;
      segmentTotals.set(key, row);
    }
    const segmentMix = ["residential", "commercial", "government", "unknown"]
      .map(key => ({
        segment: key,
        jobs: segmentTotals.get(key)?.jobs ?? 0,
        value: Math.round(segmentTotals.get(key)?.value ?? 0),
      }))
      .filter(row => row.jobs > 0);

    const syncRows = await ctx.db.query("syncState").collect();
    const quickbooks = syncRows.find(row => row.source === "quickbooks");

    return {
      range,
      period,
      line,
      backlog: {
        weeks: current.weeks,
        openValue: current.openValue,
        weeklyRunRate: current.weeklyRunRate,
        targetLow: TARGET_BAND.low,
        targetHigh: TARGET_BAND.high,
        runsOut,
        production: { weeks: production.weeks, openValue: production.openValue },
        phc: { weeks: phc.weeks, openValue: phc.openValue },
        series,
      },
      jobSet: {
        jobsClosed: closed.length,
        closedValue: Math.round(sum(closed.map(inv => inv.valueExTax))),
        consultations: closedAll.filter(inv => inv.consultation).length,
      },
      segment,
      segmentMix,
      cities,
      scheduleAhead,
      jobMix,
      marginSource:
        quickbooks && quickbooks.status === "ok"
          ? "quickbooks"
          : "pending",
      openEstimates: {
        maxAgeDays: OPEN_ESTIMATE_MAX_AGE_DAYS,
        count: openEstimates.length,
        value: Math.round(sum(openEstimates.map(estimate => estimate.valueExTax))),
        buckets: Object.entries(buckets).map(([label, row]) => ({
          label,
          count: row.count,
          value: Math.round(row.value),
        })),
        largest: largestOpen,
      },
      proposalValueWon: {
        all: proposalValueWonFor("all"),
        production: proposalValueWonFor("production"),
        phc: proposalValueWonFor("phc"),
      },
    };
  },
});
