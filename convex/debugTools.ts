import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { callTool, arbostarGet } from "./gateway";
import { categorize } from "./leadCategories";

export const rawArbostar = internalAction({
  args: {},
  returns: v.string(),
  handler: async () => {
    const raw = await callTool<unknown>("mcp_custom_api_arbostar_crm_get", {
      path: "/api/v1/workorders",
      query_params: { limit: "2" },
      headers: { "User-Agent": "ArboStar-Viktor-Integration/1.0" },
      timeout_ms: 30000,
    });
    return JSON.stringify(raw).slice(0, 1200);
  },
});

import { internalQuery } from "./_generated/server";

export const counts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const jobs = await ctx.db.query("jobs").collect();
    const estimates = await ctx.db.query("estimates").collect();
    const withLine = jobs.filter(j => j.serviceLine).length;
    const finished = jobs.filter(j => j.finished).length;
    const dates = jobs.map(j => j.createdAt).sort();
    const estDates = estimates.map(e => e.createdAt).sort();
    return {
      jobs: jobs.length,
      jobsWithServiceLine: withLine,
      finished,
      jobRange: [dates[0], dates[dates.length - 1]],
      estimates: estimates.length,
      estRange: [estDates[0], estDates[estDates.length - 1]],
    };
  },
});

import { internalMutation } from "./_generated/server";
import { ROLE_SCREENS } from "./access";

/** Seeds reviewer and test accounts so the preview is usable. */
export const seedAccess = internalMutation({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const seeds = [
      { email: "w.rivers@treenewal.com", name: "Wes Rivers", role: "owner" as const },
      { email: "chris@thinkcre8tive.com", name: "Chris Wielinski", role: "owner" as const },
      { email: "agent-czipijy5axsj80un@test.local", name: "Preview user", role: "owner" as const },
    ];
    for (const seed of seeds) {
      const existing = await ctx.db
        .query("access")
        .withIndex("by_email", q => q.eq("email", seed.email))
        .unique();
      if (!existing) {
        await ctx.db.insert("access", {
          email: seed.email,
          name: seed.name,
          role: seed.role,
          screens: { ...ROLE_SCREENS[seed.role] },
        });
      }
    }
    return "ok";
  },
});

export const backlogVariants = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const jobs = await ctx.db.query("jobs").collect();
    const day = (n: number) =>
      new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const openAll = jobs.filter(j => !j.finished);
    const open180 = openAll.filter(j => j.createdAt >= day(180));
    const open90 = openAll.filter(j => j.createdAt >= day(90));
    const sum = (rows: typeof jobs) => Math.round(rows.reduce((t, j) => t + j.value, 0));
    const fin = (days: number) =>
      jobs.filter(j => j.finished && j.createdAt >= day(days));
    return {
      openAll: [openAll.length, sum(openAll)],
      open180: [open180.length, sum(open180)],
      open90: [open90.length, sum(open90)],
      finished84: [fin(84).length, sum(fin(84)), Math.round(sum(fin(84)) / 12)],
      finished182: [fin(182).length, sum(fin(182)), Math.round(sum(fin(182)) / 26)],
      finished365: [fin(365).length, sum(fin(365)), Math.round(sum(fin(365)) / 52)],
    };
  },
});

export const openMix = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const jobs = await ctx.db.query("jobs").collect();
    const day = (n: number) =>
      new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const open = jobs.filter(j => !j.finished && j.createdAt >= day(180));
    const byStatus: Record<string, [number, number]> = {};
    for (const j of open) {
      const k = j.statusName;
      const cur = byStatus[k] ?? [0, 0];
      byStatus[k] = [cur[0] + 1, Math.round(cur[1] + j.value)];
    }
    const byMonth: Record<string, number> = {};
    for (const j of open) {
      const k = j.createdAt.slice(0, 7);
      byMonth[k] = Math.round((byMonth[k] ?? 0) + j.value);
    }
    return { count: open.length, byStatus, byMonth };
  },
});

export const invoiceCounts = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const inv = await ctx.db.query("invoices").collect();
    const dates = inv.map(i => i.date).sort();
    return {
      count: inv.length,
      range: [dates[0], dates[dates.length - 1]],
      consultations: inv.filter(i => i.consultation).length,
      withLine: inv.filter(i => i.serviceLine).length,
      sample: inv.slice(-3).map(i => [i.number, i.date, i.valueExTax, i.serviceLine ?? "none", i.consultation, i.city]),
    };
  },
});

export const sync = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("syncState").collect();
    return rows.map(r => `${r.source}: ${r.status} ${r.message ?? ""} n=${r.recordCount ?? 0}`);
  },
});

/** Dumps the shape of one invoice and one work order for field discovery. */
export const rawShapes = internalAction({
  args: { path: v.string(), limit: v.optional(v.string()), offset: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const inner = (await arbostarGet(args.path, {
      limit: args.limit ?? "1",
      offset: args.offset ?? "0",
    })) as { data?: unknown[] };
    const rows = inner.data ?? [];
    return JSON.stringify(rows[0] ?? inner).slice(0, 6000);
  },
});

/** Probes candidate ArboStar endpoints and reports which exist. */
export const probePaths = internalAction({
  args: { paths: v.array(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const out: Record<string, string> = {};
    for (const p of args.paths) {
      try {
        const res = (await arbostarGet(p, { limit: "1" })) as {
          data?: unknown[];
          total_rows?: number;
          total?: number;
        };
        const rows = res.data ?? [];
        out[p] = `ok total=${res.total_rows ?? res.total ?? "?"} keys=${
          rows[0] ? Object.keys(rows[0] as object).join(",") : "none"
        }`;
      } catch (err) {
        out[p] = `err ${(err as Error).message}`.slice(0, 120);
      }
    }
    return out;
  },
});

/** Invoice and job counts by month, to spot gaps in a backfill. */
export const monthly = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const inv = await ctx.db.query("invoices").collect();
    const jobs = await ctx.db.query("jobs").collect();
    const bucket = (rows: { d: string }[]) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[r.d.slice(0, 7)] = (m[r.d.slice(0, 7)] ?? 0) + 1;
      return m;
    };
    return {
      invoices: bucket(inv.map(i => ({ d: i.date }))),
      jobs: bucket(jobs.map(j => ({ d: j.createdAt }))),
    };
  },
});

/** Top level keys, totals and first item of one ArboStar row. */
export const rowKeys = internalAction({
  args: { path: v.string(), offset: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const res = (await arbostarGet(args.path, {
      limit: "1",
      offset: args.offset ?? "0",
    })) as { data?: Record<string, any>[] };
    const row = (res.data ?? [])[0] ?? {};
    const items = (row.items ?? []) as Record<string, any>[];
    return {
      keys: Object.keys(row),
      totals: row.totals ?? null,
      itemCount: items.length,
      firstItem: items[0]
        ? {
            keys: Object.keys(items[0]),
            name: items[0].item?.name ?? items[0].name,
            className: items[0].class?.name ?? items[0].item?.class?.name,
            price: items[0].price,
            qty: items[0].qty,
          }
        : null,
    };
  },
});

/** Inspects stored invoices whose service type lines do not add to the invoice. */
export const lineAudit = internalQuery({
  args: { name: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { name }) => {
    const invoices = await ctx.db.query("invoices").collect();
    const rows = invoices
      .filter(inv => !inv.excluded)
      .map(inv => ({
        number: inv.number,
        date: inv.date,
        exTax: Math.round(inv.valueExTax),
        lines: (inv.serviceTypes ?? []).map(t => `${t.name}=${Math.round(t.amount)}`),
        lineSum: Math.round(
          (inv.serviceTypes ?? []).reduce((a, t) => a + t.amount, 0),
        ),
      }));
    const target = name
      ? rows.filter(r => r.lines.some(l => l.toLowerCase().includes(name.toLowerCase())))
      : rows.filter(r => Math.abs(r.lineSum - r.exTax) > Math.max(50, r.exTax * 0.1));
    return { matched: target.length, sample: target.slice(0, 8) };
  },
});


/** PHC backlog components, to sanity check the twenty six week figure. */
export const phcBacklog = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const jobs = await ctx.db.query("jobs").collect();
    const invoices = await ctx.db.query("invoices").collect();
    const closed = new Set(
      invoices.filter(i => !i.excluded && i.workOrderId).map(i => i.workOrderId),
    );
    const today = new Date().toISOString().slice(0, 10);
    const oldest = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    const open = jobs.filter(
      j =>
        j.serviceLine === "phc" &&
        j.createdAt >= oldest &&
        !closed.has(j.arboId) &&
        !j.statusName.toLowerCase().includes("dead"),
    );
    const byStatus = new Map<string, { n: number; value: number }>();
    for (const j of open) {
      const row = byStatus.get(j.statusName) ?? { n: 0, value: 0 };
      row.n += 1;
      row.value += j.value;
      byStatus.set(j.statusName, row);
    }
    const rate = invoices.filter(
      i =>
        !i.excluded &&
        !i.consultation &&
        i.serviceLine === "phc" &&
        i.date > new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10),
    );
    return {
      today,
      openCount: open.length,
      openValue: Math.round(open.reduce((a, j) => a + j.value, 0)),
      byStatus: [...byStatus.entries()]
        .map(([s, r]) => ({ status: s, n: r.n, value: Math.round(r.value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
      phcInvoices26w: rate.length,
      phcInvoiced26w: Math.round(rate.reduce((a, i) => a + i.valueExTax, 0)),
    };
  },
});

/** Why do some invoices not reconcile to their line items? */
export const mismatchProfile = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const invoices = (await ctx.db.query("invoices").collect()).filter(
      inv => !inv.excluded,
    );
    const buckets: Record<string, { count: number; value: number; sample: string[] }> = {};
    const put = (key: string, inv: any) => {
      const row = buckets[key] ?? { count: 0, value: 0, sample: [] };
      row.count += 1;
      row.value += inv.valueExTax;
      if (row.sample.length < 4) {
        row.sample.push(
          `${inv.number} ${inv.date} exTax=${Math.round(inv.valueExTax)} lines=${Math.round(
            (inv.serviceTypes ?? []).reduce((a: number, t: any) => a + t.amount, 0),
          )}`,
        );
      }
      buckets[key] = row;
    };
    for (const inv of invoices) {
      const lines = inv.serviceTypes ?? [];
      const lineSum = lines.reduce((a, t) => a + t.amount, 0);
      const off = Math.abs(lineSum - inv.valueExTax);
      if (off <= Math.max(50, inv.valueExTax * 0.1)) {
        put("reconciles", inv);
        continue;
      }
      if (inv.consultation) put("consultation", inv);
      else if (lines.length === 0) put("no lines", inv);
      else if (lineSum > inv.valueExTax) put("lines exceed invoice (partial or deposit)", inv);
      else put("invoice exceeds lines", inv);
    }
    return Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [
        k,
        { count: v.count, value: Math.round(v.value), sample: v.sample },
      ]),
    );
  },
});

/** Shape of the open receivables, to judge how much of it is real. */
export const arProfile = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const today = new Date().toISOString().slice(0, 10);
    const open = (await ctx.db.query("invoices").collect()).filter(
      inv => !inv.excluded && !inv.isPaid && inv.due > 0.5,
    );
    const days = (d: string) =>
      Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
    const band = (inv: any) => {
      const d = inv.due;
      if (d < 25) return "under 25";
      if (d < 100) return "25 to 100";
      if (d < 500) return "100 to 500";
      if (d < 2000) return "500 to 2k";
      return "2k and up";
    };
    const out: Record<string, { count: number; value: number; over60: number }> = {};
    for (const inv of open) {
      const key = band(inv);
      const row = out[key] ?? { count: 0, value: 0, over60: 0 };
      row.count += 1;
      row.value += inv.due;
      if (days(inv.date) > 60) row.over60 += 1;
      out[key] = row;
    }
    const largest = open
      .slice()
      .sort((a, b) => b.due - a.due)
      .slice(0, 8)
      .map(inv => `${inv.clientName ?? "?"} ${inv.number} ${inv.date} due=${Math.round(inv.due)} paid=${Math.round(inv.paidTotal)} total=${Math.round(inv.total)}`);
    return {
      bands: Object.fromEntries(
        Object.entries(out).map(([k, v]) => [k, { ...v, value: Math.round(v.value) }]),
      ),
      largest,
    };
  },
});

/** A raw look at recent leads, to see what attribution ArboStar records. */
export const rawLeads = internalAction({
  args: { offset: v.optional(v.number()) },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const res = (await arbostarGet("/api/v1/leads", {
      limit: 3,
      offset: args.offset ?? 0,
    })) as { data?: unknown[]; total_rows?: number };
    return JSON.stringify({
      total: res.total_rows,
      rows: (res.data ?? []).slice(0, 3),
    }).slice(0, 4000);
  },
});

/** Master list of lead sources with volume, for categorization. */
export const leadSourceMaster = internalQuery({
  args: {},
  handler: async ctx => {
    const leads = await ctx.db.query("leads").collect();
    const total = new Map<string, number>();
    const recent = new Map<string, number>();
    for (const lead of leads) {
      const key = lead.source ?? "Not recorded";
      total.set(key, (total.get(key) ?? 0) + 1);
      if (lead.createdAt >= "2026-01-01") recent.set(key, (recent.get(key) ?? 0) + 1);
    }
    return [...total.entries()]
      .map(([source, count]) => ({ source, count, since2026: recent.get(source) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  },
});

/** Category totals since Jan, to advise on how many buckets are worth keeping. */
export const categoryTotals = internalQuery({
  args: {},
  handler: async ctx => {
    const leads = await ctx.db.query("leads").collect();
    const out = new Map<string, number>();
    for (const lead of leads) {
      if (lead.createdAt < "2026-01-01") continue;
      const key = categorize(lead.source);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  },
});
