import { v } from "convex/values";
import { requireScreen } from "./access";
import { authenticatedQuery } from "./functions";
import { matchesSegment, type SegmentFilter } from "./backlog";
import { type PeriodKey, periodRange } from "./periods";

/**
 * Job Map.
 *
 * One pin per closed job, read from the same invoice spine as the Overview
 * and the Jobs screen, so the pin count, the city rows and the inside and
 * outside figures all reconcile by construction. City appears here as
 * demand only. Nothing on this screen splits revenue or margin by city.
 */

/** Centre of the paid ad radius. Southlake, Texas. */
export const AD_CENTER = { lat: 32.9412, lon: -97.1342 } as const;
export const AD_RADIUS_MILES = 15;

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

/** Great circle distance in miles. */
function milesBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export const map = authenticatedQuery({
  args: {
    period: periodArg,
    line: lineArg,
    minValue: v.optional(v.number()),
    segment: v.optional(
      v.union(
        v.literal("all"),
        v.literal("exclude_government"),
        v.literal("government"),
      ),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { period, line, minValue, segment: segmentArgValue }) => {
    const segment: SegmentFilter = segmentArgValue ?? "all";
    await requireScreen(ctx, "map");

    const now = Date.now();
    const range = periodRange(period as PeriodKey, now);
    const floor = minValue ?? 0;

    const closed = (
      await ctx.db
        .query("invoices")
        .withIndex("by_date", q => q.gte("date", range.start).lte("date", range.end))
        .collect()
    ).filter(
      inv =>
        !inv.excluded &&
        !inv.consultation &&
        matchesLine(inv.serviceLine, line) &&
        matchesSegment(inv.segment, segment) &&
        inv.valueExTax >= floor,
    );

    const pins = closed
      .filter(inv => typeof inv.lat === "number" && typeof inv.lon === "number")
      .map(inv => {
        const lat = inv.lat as number;
        const lon = inv.lon as number;
        return {
          id: inv.arboId,
          number: inv.number,
          date: inv.date,
          lat,
          lon,
          city: inv.city ?? "",
          value: Math.round(inv.valueExTax),
          serviceLine: effectiveLine(inv.serviceLine),
          segment: inv.segment ?? "unknown",
          inside:
            milesBetween(AD_CENTER.lat, AD_CENTER.lon, lat, lon) <= AD_RADIUS_MILES,
        };
      });

    const inside = pins.filter(pin => pin.inside);
    const outside = pins.filter(pin => !pin.inside);

    const cityTotals = new Map<string, { jobs: number; lat: number; lon: number }>();
    for (const pin of pins) {
      const city = pin.city.trim();
      if (city.length === 0) continue;
      const row = cityTotals.get(city) ?? { jobs: 0, lat: 0, lon: 0 };
      row.jobs += 1;
      row.lat += pin.lat;
      row.lon += pin.lon;
      cityTotals.set(city, row);
    }
    const cities = [...cityTotals.entries()]
      .map(([city, row]) => ({
        city,
        jobs: row.jobs,
        lat: row.lat / row.jobs,
        lon: row.lon / row.jobs,
      }))
      .sort((a, b) => b.jobs - a.jobs);

    const values = pins.map(pin => pin.value).sort((a, b) => a - b);

    return {
      range,
      period,
      line,
      center: AD_CENTER,
      radiusMiles: AD_RADIUS_MILES,
      segment,
      segmentCounts: {
        residential: pins.filter(pin => pin.segment === "residential").length,
        commercial: pins.filter(pin => pin.segment === "commercial").length,
        government: pins.filter(pin => pin.segment === "government").length,
        unknown: pins.filter(pin => pin.segment === "unknown").length,
      },
      jobsMapped: pins.length,
      jobsClosed: closed.length,
      unmapped: closed.length - pins.length,
      insideShare:
        pins.length > 0 ? Math.round((inside.length / pins.length) * 100) : null,
      insideCount: inside.length,
      outsideCount: outside.length,
      averageInside: average(inside.map(pin => pin.value)),
      averageOutside: average(outside.map(pin => pin.value)),
      valueRange: {
        low: values.length > 0 ? values[0] : 0,
        high: values.length > 0 ? values[values.length - 1] : 0,
      },
      cities,
      pins,
    };
  },
});
