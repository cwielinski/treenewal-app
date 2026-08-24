/**
 * Period handling for the whole dashboard.
 *
 * The period selector and the service line filter drive every figure on
 * every screen, so both live here and on the server, never in a component.
 * TreeNewal runs on Central time and a January fiscal year.
 */
export const PERIOD_KEYS = [
  "mtd",
  "last_month",
  "qtd",
  "ytd",
  "ttm",
] as const;

export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  mtd: "Month to date",
  last_month: "Last month",
  qtd: "Quarter to date",
  ytd: "Year to date",
  ttm: "Trailing twelve months",
};

export type DateRange = { start: string; end: string };

const TIME_ZONE = "America/Chicago";

/** Today in Central time as YYYY-MM-DD, independent of server time zone. */
export function todayInCentral(now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return parts; // en-CA already formats as YYYY-MM-DD
}

function ymd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function periodRange(key: PeriodKey, now: number = Date.now()): DateRange {
  const today = todayInCentral(now);
  const [year, month] = today.split("-").map(Number);

  switch (key) {
    case "mtd":
      return { start: ymd(year, month, 1), end: today };
    case "last_month": {
      const lastMonth = month === 1 ? 12 : month - 1;
      const lastYear = month === 1 ? year - 1 : year;
      return {
        start: ymd(lastYear, lastMonth, 1),
        end: ymd(lastYear, lastMonth, lastDayOfMonth(lastYear, lastMonth)),
      };
    }
    case "qtd": {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { start: ymd(year, quarterStartMonth, 1), end: today };
    }
    case "ytd":
      return { start: ymd(year, 1, 1), end: today };
    case "ttm":
      return { start: addDays(today, -364), end: today };
  }
}

/** The same window one year earlier, for the year over year comparisons. */
export function priorYearRange(range: DateRange): DateRange {
  const shift = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return ymd(y - 1, m, Math.min(d, lastDayOfMonth(y - 1, m)));
  };
  return { start: shift(range.start), end: shift(range.end) };
}

export function isWithin(date: string, range: DateRange): boolean {
  return date !== "" && date >= range.start && date <= range.end;
}

/** Length of a range in weeks, used by the backlog run rate. */
export function weeksBetween(range: DateRange): number {
  const [ys, ms, ds] = range.start.split("-").map(Number);
  const [ye, me, de] = range.end.split("-").map(Number);
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  return Math.max(1, (end - start) / (7 * 24 * 60 * 60 * 1000));
}
