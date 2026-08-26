import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const serviceLine = v.union(v.literal("production"), v.literal("phc"));

/**
 * Who is billed, from the ArboStar client record. Government work distorts
 * open estimates and receivables, so every screen can filter it in or out.
 */
const segment = v.union(
  v.literal("residential"),
  v.literal("commercial"),
  v.literal("government"),
);

const schema = defineSchema({
  ...authTables,

  /**
   * ArboStar work orders, mirrored on a schedule. One row per job.
   * This is the single job set behind average job value, the city rows
   * and the map, so all three reconcile by construction.
   */
  jobs: defineTable({
    arboId: v.number(),
    number: v.string(),
    createdAt: v.string(), // YYYY-MM-DD
    statusName: v.string(),
    statusId: v.optional(v.number()),
    estimateId: v.optional(v.number()),
    serviceLine: v.optional(serviceLine),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zip: v.optional(v.string()),
    lat: v.optional(v.number()),
    lon: v.optional(v.number()),
    clientName: v.optional(v.string()),
    clientId: v.optional(v.number()),
    segment: v.optional(segment),
    value: v.number(), // ex tax work order value
    invoiced: v.number(),
    paid: v.number(),
    due: v.number(),
    finished: v.boolean(),
  })
    .index("by_arboId", ["arboId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_finished_and_createdAt", ["finished", "createdAt"])
    .index("by_estimateId", ["estimateId"]),

  /**
   * ArboStar invoices. This is the closing spine of the dashboard: a job
   * counts as closed on its invoice date, which is also what QuickBooks
   * bills on, and every row carries the QuickBooks id so the two reconcile.
   */
  invoices: defineTable({
    arboId: v.number(),
    number: v.string(),
    date: v.string(), // YYYY-MM-DD, the invoice date
    workOrderId: v.optional(v.number()),
    estimateId: v.optional(v.number()),
    quickbooksId: v.optional(v.string()),
    serviceLine: v.optional(serviceLine),
    /** Arborist consultations are lead generation, not delivered work. */
    consultation: v.boolean(),
    /**
     * Bookkeeping rows that are not jobs: ArboStar tax adjustments and zero
     * value warranty invoices. Excluded from every figure.
     */
    excluded: v.optional(v.boolean()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zip: v.optional(v.string()),
    lat: v.optional(v.number()),
    lon: v.optional(v.number()),
    clientName: v.optional(v.string()),
    segment: v.optional(segment),
    valueExTax: v.number(),
    total: v.number(),
    paidTotal: v.number(),
    due: v.number(),
    isPaid: v.boolean(),
    payments: v.array(v.object({ date: v.string(), amount: v.number() })),
    /**
     * Delivered service types on the invoice, from the ArboStar catalogue.
     * Overhead lines such as card fees and crew tips are left out, so these
     * sum to the delivered value of the job.
     */
    serviceTypes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          line: v.optional(serviceLine),
          amount: v.number(),
        }),
      ),
    ),
  })
    .index("by_arboId", ["arboId"])
    .index("by_date", ["date"])
    .index("by_workOrderId", ["workOrderId"]),

  /**
   * ArboStar leads. The lead carries the source recorded at intake, which
   * is the attribution rule for the whole Marketing screen: first contact,
   * not every touch.
   */
  leads: defineTable({
    arboId: v.number(),
    number: v.string(),
    createdAt: v.string(),
    source: v.string(),
    sourceId: v.optional(v.number()),
    statusName: v.string(),
    clientId: v.optional(v.number()),
    clientName: v.optional(v.string()),
    city: v.optional(v.string()),
  })
    .index("by_arboId", ["arboId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_clientId", ["clientId"]),

  /** ArboStar estimates, mirrored on a schedule. Drives the pipeline card. */
  estimates: defineTable({
    arboId: v.number(),
    number: v.string(),
    createdAt: v.string(),
    statusName: v.string(),
    sold: v.boolean(),
    open: v.boolean(),
    serviceLine: v.optional(serviceLine),
    valueExTax: v.number(),
    /** For the largest open estimates list: what and where. */
    topItem: v.optional(v.string()),
    city: v.optional(v.string()),
    clientName: v.optional(v.string()),
    segment: v.optional(segment),
  })
    .index("by_arboId", ["arboId"])
    .index("by_createdAt", ["createdAt"]),

  /**
   * QuickBooks figures, stored per period key and service line so the
   * screens never call QuickBooks per request.
   */
  finance: defineTable({
    periodKey: v.string(), // mtd | last_month | qtd | ytd | ttm
    line: v.union(v.literal("all"), serviceLine),
    revenue: v.optional(v.number()),
    grossProfit: v.optional(v.number()),
    cashCollected: v.optional(v.number()),
    cashOnHand: v.optional(v.number()),
    undepositedFunds: v.optional(v.number()),
    payroll: v.optional(v.number()),
    fieldLabor: v.optional(v.number()),
    overheadPayroll: v.optional(v.number()),
    subcontractorLabor: v.optional(v.number()),
    netIncome: v.optional(v.number()),
    operatingExpenses: v.optional(v.number()),
    opexBudget: v.optional(v.number()),
    debtService: v.optional(v.number()),
    revenuePriorYear: v.optional(v.number()),
    grossProfitPriorYear: v.optional(v.number()),
    cashCollectedPriorYear: v.optional(v.number()),
    payrollLastMonthShare: v.optional(v.number()),
    receivablesCurrent: v.optional(v.number()),
    receivables1to30: v.optional(v.number()),
    receivables31to60: v.optional(v.number()),
    receivables60plus: v.optional(v.number()),
    receivables60plusCount: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_periodKey_and_line", ["periodKey", "line"]),

  /**
   * The marketing leads sheet TreeNewal keeps by hand, one row per month
   * and channel. This is the source of truth for media cost: Google Ads
   * and Local Services Ads are combined into "Paid Ads", and SEO carries a
   * cost of its own.
   */
  leadSpend: defineTable({
    month: v.string(), // YYYY-MM
    channel: v.string(), // seo | paid | total
    leads: v.optional(v.number()),
    cost: v.optional(v.number()),
    sales: v.optional(v.number()),
    revenue: v.optional(v.number()),
  }).index("by_month_and_channel", ["month", "channel"]),

  /**
   * Revenue and direct cost per QuickBooks class, one document per calendar
   * month. Any period on the screen is a sum of these months, so a year to
   * date view costs one read per month rather than a fresh scrape.
   */
  classMonthly: defineTable({
    month: v.string(), // YYYY-MM
    /** Profit and loss control totals for the same month. */
    totalRevenue: v.optional(v.number()),
    totalDirectCost: v.optional(v.number()),
    overhead: v.optional(v.number()),
    rows: v.array(
      v.object({
        className: v.string(),
        revenue: v.number(),
        directCost: v.number(),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_month", ["month"]),

  /**
   * In app chat. One document per conversation, owned by the person who
   * started it. Conversations are private to that person: the answers can
   * carry payroll and receivables, so they are never shared.
   */
  chatThreads: defineTable({
    userId: v.id("users"),
    title: v.string(),
    category: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_and_updated", ["userId", "updatedAt"]),

  chatMessages: defineTable({
    threadId: v.id("chatThreads"),
    userId: v.id("users"),
    author: v.union(v.literal("person"), v.literal("viktor")),
    text: v.string(),
    /** Set when the answer failed, so the interface can say so plainly. */
    failed: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_thread", ["threadId", "createdAt"]),

  /** One row per source, so the header can show a real last refresh time. */
  syncState: defineTable({
    source: v.string(), // arbostar | quickbooks
    status: v.string(), // ok | running | error | unavailable
    message: v.optional(v.string()),
    recordCount: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastRunAt: v.number(),
  }).index("by_source", ["source"]),

  /**
   * Per screen permissions, enforced in Convex and not only in the UI.
   * Owner sees everything, manager everything except Cash, staff Jobs and
   * Map only. Cash is granted on its own and is off by default.
   */
  access: defineTable({
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.union(
      v.literal("owner"),
      v.literal("manager"),
      v.literal("staff"),
      v.literal("none"),
    ),
    screens: v.object({
      overview: v.boolean(),
      jobs: v.boolean(),
      map: v.boolean(),
      cash: v.boolean(),
      marketing: v.boolean(),
    }),
  })
    .index("by_email", ["email"])
    .index("by_userId", ["userId"]),
});

export default schema;
