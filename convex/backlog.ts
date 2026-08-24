import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { isDeadStatus, scheduledMonthFromStatus } from "./serviceLine";

/**
 * Backlog, defined once for the whole dashboard.
 *
 * Weeks of sold work on the books: work orders that have been sold and not
 * yet invoiced, divided by the invoiced run rate of the last twenty six
 * weeks. The invoice is the closing signal, which is also what QuickBooks
 * bills on, so a job leaves the backlog on the day the two systems agree it
 * closed.
 *
 * Two kinds of work are left out, because neither is a queue the crew is
 * behind on: dead work orders, and Plant Health Care rounds parked in a
 * status named for a future treatment month. Those rounds are shown on the
 * Jobs screen as the schedule ahead instead.
 *
 * Every screen calls this, so the Overview and the Jobs screen cannot drift
 * apart.
 */

export const TARGET_BAND = { low: 2.5, high: 3 } as const;
/** Work orders older than this are stale paperwork, not a queue. */
export const BACKLOG_MAX_AGE_DAYS = 180;
export const RUN_RATE_WEEKS = 26;

export type Line = "all" | "production" | "phc";

export function effectiveLine(recordLine: string | undefined): "production" | "phc" {
  return recordLine === "phc" ? "phc" : "production";
}

export function matchesLine(recordLine: string | undefined, line: Line): boolean {
  if (line === "all") return true;
  return effectiveLine(recordLine) === line;
}

export function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type BacklogInputs = {
  jobs: Doc<"jobs">[];
  invoices: Doc<"invoices">[];
  /** Invoice date by work order id: the date a job left the books. */
  closedOn: Map<number, string>;
};

export async function backlogInputs(ctx: QueryCtx): Promise<BacklogInputs> {
  const jobs = await ctx.db.query("jobs").collect();
  const invoices = await ctx.db.query("invoices").collect();
  const closedOn = new Map<number, string>();
  for (const invoice of invoices) {
    if (invoice.excluded || invoice.workOrderId === undefined) continue;
    const current = closedOn.get(invoice.workOrderId);
    if (current === undefined || invoice.date < current) {
      closedOn.set(invoice.workOrderId, invoice.date);
    }
  }
  return { jobs, invoices, closedOn };
}

/** True when a job is booked into a treatment month still ahead of us. */
export function isScheduledAhead(job: Doc<"jobs">, asOf: string): boolean {
  const month = scheduledMonthFromStatus(job.statusName);
  return month !== undefined && month > asOf.slice(0, 7);
}

export function backlogAt(
  input: BacklogInputs,
  asOf: string,
  line: Line,
): { weeks: number | null; openValue: number; weeklyRunRate: number } {
  const oldest = shiftDays(asOf, -BACKLOG_MAX_AGE_DAYS);
  let openValue = 0;
  for (const job of input.jobs) {
    if (job.createdAt > asOf || job.createdAt < oldest) continue;
    if (isDeadStatus(job.statusName)) continue;
    if (isScheduledAhead(job, asOf)) continue;
    if (!matchesLine(job.serviceLine, line)) continue;
    const closed = input.closedOn.get(job.arboId);
    if (closed !== undefined && closed <= asOf) continue;
    openValue += job.value;
  }

  const rateStart = shiftDays(asOf, -RUN_RATE_WEEKS * 7);
  let invoiced = 0;
  for (const invoice of input.invoices) {
    if (invoice.excluded || invoice.consultation) continue;
    if (invoice.date <= rateStart || invoice.date > asOf) continue;
    if (!matchesLine(invoice.serviceLine, line)) continue;
    invoiced += invoice.valueExTax;
  }
  const weeklyRunRate = invoiced / RUN_RATE_WEEKS;
  const weeks =
    weeklyRunRate > 0 ? Math.round((openValue / weeklyRunRate) * 10) / 10 : null;

  return {
    weeks,
    openValue: Math.round(openValue),
    weeklyRunRate: Math.round(weeklyRunRate),
  };
}
