import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { type Screens, screensFor } from "./access";
import {
  authenticatedAction,
  authenticatedMutation,
  authenticatedQuery,
} from "./functions";
import { callTool } from "./gateway";
import { todayInCentral } from "./periods";

/**
 * Ask the dashboard a question.
 *
 * The rules that matter here:
 *
 *  - A conversation belongs to one person. Answers can carry payroll and
 *    receivables, so nothing is shared between accounts.
 *  - The model only ever sees figures the person is allowed to see. Cash
 *    numbers are stripped from the context for anyone without the Cash
 *    screen, so the chat cannot be used to walk around the permissions.
 *  - The model is given figures, not database access. It reads a snapshot
 *    of what the screens already show and answers from that, which keeps
 *    it honest and keeps a question cheap.
 */

const CATEGORY_DEFAULT = "General";
/** Turns of history sent back to the model. Older turns are dropped. */
const HISTORY_TURNS = 12;

function titleFrom(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57)}...`;
}

const threadShape = v.object({
  _id: v.id("chatThreads"),
  title: v.string(),
  category: v.string(),
  updatedAt: v.number(),
});

async function ownThread(
  ctx: { db: any; userId: Id<"users"> },
  threadId: Id<"chatThreads">,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.userId !== ctx.userId) {
    throw new Error("That conversation is not yours.");
  }
  return thread;
}

export const listThreads = authenticatedQuery({
  args: {},
  returns: v.array(threadShape),
  handler: async ctx => {
    const rows = await ctx.db
      .query("chatThreads")
      .withIndex("by_user_and_updated", q => q.eq("userId", ctx.userId))
      .order("desc")
      .take(200);
    return rows.map(row => ({
      _id: row._id,
      title: row.title,
      category: row.category,
      updatedAt: row.updatedAt,
    }));
  },
});

export const messages = authenticatedQuery({
  args: { threadId: v.id("chatThreads") },
  returns: v.array(
    v.object({
      _id: v.id("chatMessages"),
      author: v.union(v.literal("person"), v.literal("viktor")),
      text: v.string(),
      failed: v.optional(v.boolean()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    await ownThread(ctx, threadId);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_thread", q => q.eq("threadId", threadId))
      .order("asc")
      .take(500);
    return rows.map(row => ({
      _id: row._id,
      author: row.author,
      text: row.text,
      failed: row.failed,
      createdAt: row.createdAt,
    }));
  },
});

export const createThread = authenticatedMutation({
  args: { title: v.optional(v.string()), category: v.optional(v.string()) },
  returns: v.id("chatThreads"),
  handler: async (ctx, { title, category }) => {
    const now = Date.now();
    return await ctx.db.insert("chatThreads", {
      userId: ctx.userId,
      title: title?.trim() || "New conversation",
      category: category?.trim() || CATEGORY_DEFAULT,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const renameThread = authenticatedMutation({
  args: {
    threadId: v.id("chatThreads"),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, title, category }) => {
    await ownThread(ctx, threadId);
    const patch: Record<string, string> = {};
    if (title !== undefined && title.trim()) patch.title = title.trim().slice(0, 120);
    if (category !== undefined) patch.category = category.trim() || CATEGORY_DEFAULT;
    await ctx.db.patch(threadId, patch);
    return null;
  },
});

export const deleteThread = authenticatedMutation({
  args: { threadId: v.id("chatThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await ownThread(ctx, threadId);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_thread", q => q.eq("threadId", threadId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(threadId);
    return null;
  },
});

/* Internal plumbing for the action. */

export const addMessage = internalMutation({
  args: {
    threadId: v.id("chatThreads"),
    userId: v.id("users"),
    author: v.union(v.literal("person"), v.literal("viktor")),
    text: v.string(),
    failed: v.optional(v.boolean()),
    retitle: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("chatMessages", {
      threadId: args.threadId,
      userId: args.userId,
      author: args.author,
      text: args.text,
      failed: args.failed,
      createdAt: Date.now(),
    });
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.retitle) patch.title = args.retitle;
    await ctx.db.patch(args.threadId, patch);
    return null;
  },
});

export const conversationFor = internalQuery({
  args: { threadId: v.id("chatThreads"), userId: v.id("users") },
  returns: v.object({
    history: v.array(v.object({ author: v.string(), text: v.string() })),
    isFirst: v.boolean(),
    context: v.string(),
  }),
  handler: async (ctx, { threadId, userId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== userId) {
      throw new Error("That conversation is not yours.");
    }
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_thread", q => q.eq("threadId", threadId))
      .order("desc")
      .take(HISTORY_TURNS * 2);
    const history = rows
      .reverse()
      .map(row => ({ author: row.author as string, text: row.text }));

    const screens = await screensFor(ctx, userId);
    const context = await buildContext(ctx, screens);
    return { history, isFirst: rows.length === 0, context };
  },
});

/** The figures the model is allowed to reason over, as plain text. */
async function buildContext(
  ctx: { db: any },
  screens: Screens,
): Promise<string> {
  const lines: string[] = [];
  const money = (value?: number) =>
    value === undefined ? "not available" : `$${Math.round(value).toLocaleString("en-US")}`;

  lines.push(`Today is ${todayInCentral()} in Central time.`);
  lines.push(
    "TreeNewal is one location with one crew pool and one profit and loss. Cities are marketing service areas, never operating units, so revenue, margin, payroll and capacity are never split by city.",
  );

  const finance = await ctx.db.query("finance").collect();
  const periodNames: Record<string, string> = {
    mtd: "month to date",
    last_month: "last month",
    qtd: "quarter to date",
    ytd: "year to date",
    ttm: "trailing twelve months",
  };
  lines.push("", "FIGURES BY PERIOD (all work unless the line says otherwise):");
  for (const row of finance) {
    const name = periodNames[row.periodKey] ?? row.periodKey;
    const parts = [
      `revenue ${money(row.revenue)}`,
      `gross profit ${money(row.grossProfit)}`,
    ];
    if (screens.cash) {
      parts.push(
        `cash collected ${money(row.cashCollected)}`,
        `payroll ${money(row.payroll)}`,
        `field labour ${money(row.fieldLabor)}`,
        `overhead payroll ${money(row.overheadPayroll)}`,
        `operating expenses ${money(row.operatingExpenses)}`,
        `debt service ${money(row.debtService)}`,
        `net income ${money(row.netIncome)}`,
        `cash on hand ${money(row.cashOnHand)}`,
        `open receivable ${money(
          (row.receivablesCurrent ?? 0) +
            (row.receivables1to30 ?? 0) +
            (row.receivables31to60 ?? 0) +
            (row.receivables60plus ?? 0),
        )}`,
      );
    }
    lines.push(`- ${name}, line ${row.line}: ${parts.join(", ")}`);
  }

  const classMonths = await ctx.db
    .query("classMonthly")
    .withIndex("by_month")
    .order("desc")
    .take(13);
  if (classMonths.length > 0) {
    lines.push(
      "",
      "REVENUE AND DIRECT COST BY TYPE OF WORK, per calendar month, from the QuickBooks class on each line. Overhead is the month's overhead pool and is not allocated here:",
    );
    for (const month of classMonths) {
      const rows = month.rows
        .filter((row: any) => row.revenue !== 0 || row.directCost !== 0)
        .map(
          (row: any) =>
            `${row.className} revenue ${money(row.revenue)} direct cost ${money(row.directCost)}`,
        );
      lines.push(
        `- ${month.month}: overhead ${money(month.overhead)}; ${rows.join("; ")}`,
      );
    }
  }

  if (screens.marketing) {
    const spend = await ctx.db.query("leadSpend").collect();
    const recent = spend
      .sort((a: any, b: any) => (a.month < b.month ? 1 : -1))
      .slice(0, 18);
    if (recent.length > 0) {
      lines.push("", "MARKETING, from the leads sheet kept by hand:");
      for (const row of recent) {
        lines.push(
          `- ${row.month} ${row.channel}: leads ${row.leads ?? "not available"}, cost ${money(
            row.cost,
          )}, sales ${row.sales ?? "not available"}, revenue ${money(row.revenue)}`,
        );
      }
      lines.push(
        "Lead source attribution inside the job software is not reliable and is deliberately not used.",
      );
    }
  }

  const sync = await ctx.db.query("syncState").collect();
  if (sync.length > 0) {
    lines.push(
      "",
      `DATA FRESHNESS: ${sync
        .map((row: any) => `${row.source} ${row.status}`)
        .join(", ")}.`,
    );
  }

  if (!screens.cash) {
    lines.push(
      "",
      "This person does not have the Cash screen. Payroll, receivables, bank balance and anything derived from them are not in the figures above. If they ask, say the Cash screen is not open to their account rather than estimating.",
    );
  }
  return lines.join("\n");
}

const SYSTEM = `You are the assistant inside TreeNewal's finance dashboard. You answer questions about the numbers on the screens.

How to answer:
- Lead with the number, then what it means. Two or three sentences is usually enough.
- Use only the figures given to you. If a figure is not there, say so plainly and say which screen would carry it. Never estimate a number that was not given and never invent one.
- Say which period a figure covers, because the same metric differs by period.
- Never split revenue, margin, payroll or capacity by city. TreeNewal is one profit and loss.
- Proposal value won is dollars won divided by dollars proposed. Close rate is jobs sold divided by estimates issued. Never use one label for the other.
- The job software is called ArboStar. The accounting system is QuickBooks.
- Overhead is held as a monthly pool, not tagged by type of work. When someone asks about profit by type of work with overhead carried, allocate the month's overhead across classes in proportion to their revenue, which is what the Overview screen does, and say that is the basis. Direct cost only and overhead allocated give different answers, so name which one you used.
- When the question is a comparison, compare every class you were given rather than answering with one.
- Calm and plain. No exclamation points, no urgency language, no emoji, no em dashes.`;

export const ask = authenticatedAction({
  args: {
    threadId: v.optional(v.id("chatThreads")),
    question: v.string(),
  },
  returns: v.object({ threadId: v.id("chatThreads") }),
  handler: async (ctx, { threadId, question }) => {
    const text = question.trim();
    if (!text) throw new Error("Ask a question first.");

    const id: Id<"chatThreads"> =
      threadId ??
      (await ctx.runMutation(api.chat.createThread, {
        title: titleFrom(text),
      }));

    const before = await ctx.runQuery(internal.chat.conversationFor, {
      threadId: id,
      userId: ctx.userId,
    });

    await ctx.runMutation(internal.chat.addMessage, {
      threadId: id,
      userId: ctx.userId,
      author: "person",
      text,
      // A conversation started from the sidebar keeps its placeholder name
      // until the first question gives it a real one.
      retitle: before.isFirst ? titleFrom(text) : undefined,
    });

    const transcript = before.history
      .map(turn => `${turn.author === "person" ? "Person" : "You"}: ${turn.text}`)
      .join("\n");

    try {
      // The gateway hands back its own envelope around the tool result, so
      // the answer sits one level down. Both shapes are accepted in case the
      // gateway is tidied up later.
      const raw = await callTool<{
        answer?: string;
        result?: { answer?: string };
      }>("ai_structured_output", {
        prompt: `${SYSTEM}\n\nFIGURES AVAILABLE TO YOU:\n${before.context}`,
        input_text: `${transcript ? `${transcript}\n` : ""}Person: ${text}`,
        output_schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
        intelligence_level: "smart",
      });
      const answer = raw.answer ?? raw.result?.answer;
      await ctx.runMutation(internal.chat.addMessage, {
        threadId: id,
        userId: ctx.userId,
        author: "viktor",
        text: answer?.trim() || "No answer came back. Try asking again.",
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.addMessage, {
        threadId: id,
        userId: ctx.userId,
        author: "viktor",
        text: `That question did not go through. ${
          error instanceof Error ? error.message : "Unknown error."
        }`,
        failed: true,
      });
    }

    return { threadId: id };
  },
});
