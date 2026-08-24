import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * The marketing leads sheet.
 *
 * TreeNewal keeps spend, leads, sales and revenue by month in one Google
 * Sheet, split into SEO and Paid Ads, where Paid Ads combines Google Ads
 * and Local Services Ads. The sheet is published for reading, so it is
 * pulled straight as CSV and no Google integration is needed.
 *
 * Layout: a block per year. A title row carrying the year, a header row,
 * twelve month rows and a totals row. Each block has three column groups
 * of seven, SEO then Paid Ads then Total.
 */

const SHEET_ID = "1IjiTr8Pmd0p99UDxMKooUR0igomEkK05LhZ6bZuPcAc";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A CSV parser that handles the quoted thousands separators in the sheet. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Sheet numbers carry commas, currency and error strings. */
function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[$,%\s]/g, "");
  if (cleaned.length === 0 || cleaned.startsWith("#")) return undefined;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type SpendRow = {
  month: string;
  channel: string;
  leads?: number;
  cost?: number;
  sales?: number;
  revenue?: number;
};

export function rowsFromCsv(text: string): SpendRow[] {
  const grid = parseCsv(text);
  const out: SpendRow[] = [];
  let year: number | undefined;
  for (const row of grid) {
    const first = (row[0] ?? "").trim();
    const yearMatch = first.match(/^(20\d{2})\b/);
    if (yearMatch) {
      year = Number(yearMatch[1]);
      continue;
    }
    if (year === undefined) continue;
    const monthIndex = MONTHS.indexOf(first.toLowerCase());
    if (monthIndex < 0) continue;
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const groups: [string, number][] = [
      ["seo", 1],
      ["paid", 8],
      ["total", 15],
    ];
    for (const [channel, offset] of groups) {
      out.push({
        month,
        channel,
        leads: num(row[offset]),
        cost: num(row[offset + 1]),
        sales: num(row[offset + 3]),
        revenue: num(row[offset + 5]),
      });
    }
  }
  return out;
}

export const syncLeadSheet = internalAction({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    try {
      const response = await fetch(CSV_URL, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`sheet returned HTTP ${response.status}`);
      }
      const text = await response.text();
      const rows = rowsFromCsv(text);
      if (rows.length === 0) throw new Error("sheet parsed to no month rows");
      await ctx.runMutation(internal.leadSheet.upsertSpend, { rows });
    } catch (error) {
      await ctx.runMutation(internal.arbostar.recordSyncError, {
        source: "leads_sheet",
        message: `leads sheet: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return null;
  },
});

export const upsertSpend = internalMutation({
  args: {
    rows: v.array(
      v.object({
        month: v.string(),
        channel: v.string(),
        leads: v.optional(v.number()),
        cost: v.optional(v.number()),
        sales: v.optional(v.number()),
        revenue: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { rows }) => {
    for (const row of rows) {
      const existing = await ctx.db
        .query("leadSpend")
        .withIndex("by_month_and_channel", q =>
          q.eq("month", row.month).eq("channel", row.channel),
        )
        .unique();
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("leadSpend", row);
    }
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_source", q => q.eq("source", "leads_sheet"))
      .unique();
    const record = {
      source: "leads_sheet",
      status: "ok",
      recordCount: rows.length,
      lastRunAt: Date.now(),
      lastSuccessAt: Date.now(),
      message: undefined,
    };
    if (state) await ctx.db.patch(state._id, record);
    else await ctx.db.insert("syncState", record);
    return null;
  },
});
