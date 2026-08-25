import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";

/**
 * Per screen access, enforced here in Convex rather than in the interface.
 * Owner sees everything. Manager sees everything except Cash. Staff sees
 * Jobs and Map only. Cash carries payroll and receivables, so it is granted
 * on its own and is off by default.
 */

export type ScreenKey = "overview" | "jobs" | "map" | "cash" | "marketing";

export const ROLE_SCREENS = {
  owner: { overview: true, jobs: true, map: true, cash: true, marketing: true },
  manager: { overview: true, jobs: true, map: true, cash: false, marketing: true },
  staff: { overview: false, jobs: true, map: true, cash: false, marketing: false },
  none: { overview: false, jobs: false, map: false, cash: false, marketing: false },
} as const;

const screensValidator = v.object({
  overview: v.boolean(),
  jobs: v.boolean(),
  map: v.boolean(),
  cash: v.boolean(),
  marketing: v.boolean(),
});

const roleValidator = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("staff"),
  v.literal("none"),
);

/** Owners of record, seeded so the first sign in is not locked out. */
const SEEDED_OWNERS = [
  "w.rivers@treenewal.com",
  "k.rivers@treenewal.com",
];

async function accessRowFor(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"access"> | null> {
  const byUser = await ctx.db
    .query("access")
    .withIndex("by_userId", q => q.eq("userId", userId))
    .unique();
  if (byUser) return byUser;

  const user = await ctx.db.get(userId);
  const email = user?.email?.toLowerCase();
  if (!email) return null;
  return await ctx.db
    .query("access")
    .withIndex("by_email", q => q.eq("email", email))
    .unique();
}

export async function requireScreen(
  ctx: QueryCtx & { userId: Id<"users"> },
  screen: ScreenKey,
): Promise<Doc<"access"> | { role: "owner"; screens: typeof ROLE_SCREENS.owner }> {
  const row = await accessRowFor(ctx, ctx.userId);
  if (row) {
    if (!row.screens[screen]) {
      throw new Error(`Your account does not have access to the ${screen} screen.`);
    }
    return row;
  }

  const user = await ctx.db.get(ctx.userId);
  const email = user?.email?.toLowerCase() ?? "";
  if (SEEDED_OWNERS.includes(email)) {
    return { role: "owner", screens: ROLE_SCREENS.owner };
  }
  throw new Error(
    "Your account has no screens assigned yet. Ask the owner to grant access.",
  );
}

/** What the signed in person may see, used to build the navigation. */
export const myAccess = authenticatedQuery({
  args: {},
  returns: v.object({
    email: v.string(),
    name: v.optional(v.string()),
    role: roleValidator,
    screens: screensValidator,
  }),
  handler: async ctx => {
    const user = await ctx.db.get(ctx.userId);
    const email = user?.email?.toLowerCase() ?? "";
    const row = await accessRowFor(ctx, ctx.userId);
    if (row) {
      return {
        email: row.email,
        name: row.name ?? user?.name ?? undefined,
        role: row.role,
        screens: row.screens,
      };
    }
    if (SEEDED_OWNERS.includes(email)) {
      return {
        email,
        name: user?.name ?? undefined,
        role: "owner" as const,
        screens: ROLE_SCREENS.owner,
      };
    }
    return {
      email,
      name: user?.name ?? undefined,
      role: "none" as const,
      screens: ROLE_SCREENS.none,
    };
  },
});

export const listAccess = authenticatedQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("access"),
      email: v.string(),
      name: v.optional(v.string()),
      role: roleValidator,
      screens: screensValidator,
    }),
  ),
  handler: async ctx => {
    const me = await accessRowFor(ctx, ctx.userId);
    const user = await ctx.db.get(ctx.userId);
    const isOwner =
      me?.role === "owner" ||
      SEEDED_OWNERS.includes(user?.email?.toLowerCase() ?? "");
    if (!isOwner) throw new Error("Only the owner can view access settings.");

    const rows = await ctx.db.query("access").collect();
    return rows.map(row => ({
      _id: row._id,
      email: row.email,
      name: row.name,
      role: row.role,
      screens: row.screens,
    }));
  },
});

export const setAccess = authenticatedMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: roleValidator,
    cash: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { email, name, role, cash }) => {
    const me = await accessRowFor(ctx, ctx.userId);
    const user = await ctx.db.get(ctx.userId);
    const isOwner =
      me?.role === "owner" ||
      SEEDED_OWNERS.includes(user?.email?.toLowerCase() ?? "");
    if (!isOwner) throw new Error("Only the owner can change access.");

    const screens = { ...ROLE_SCREENS[role] };
    // Cash is granted on its own and stays off unless it is switched on.
    screens.cash = role === "owner" ? (cash ?? true) : (cash ?? false);

    const normalized = email.trim().toLowerCase();
    const existing = await ctx.db
      .query("access")
      .withIndex("by_email", q => q.eq("email", normalized))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { role, screens, name: name ?? existing.name });
    } else {
      await ctx.db.insert("access", { email: normalized, name, role, screens });
    }
    return null;
  },
});

/**
 * True when the signed in person is an owner. Owners are the only people
 * who can change access or reset someone else's password.
 */
export async function isOwner(
  ctx: QueryCtx & { userId: Id<"users"> },
): Promise<boolean> {
  const row = await accessRowFor(ctx, ctx.userId);
  if (row) return row.role === "owner";
  const user = await ctx.db.get(ctx.userId);
  return SEEDED_OWNERS.includes(user?.email?.toLowerCase() ?? "");
}

/** The email an owner is allowed to reset, checked before the action runs. */
export const emailForReset = authenticatedQuery({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, { email }) => {
    if (!(await isOwner(ctx))) {
      throw new Error("Only an owner can reset another person's password.");
    }
    return email.trim().toLowerCase();
  },
});

/** The signed in person's own email, for a self service password change. */
export const myEmail = authenticatedQuery({
  args: {},
  returns: v.string(),
  handler: async ctx => {
    const user = await ctx.db.get(ctx.userId);
    return user?.email?.toLowerCase() ?? "";
  },
});

/** Links an access row to a user account the first time they sign in. */
export const claimAccessRow = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = user?.email?.toLowerCase();
    if (!email) return null;
    const row = await ctx.db
      .query("access")
      .withIndex("by_email", q => q.eq("email", email))
      .unique();
    if (row && row.userId !== userId) {
      await ctx.db.patch(row._id, { userId });
    } else if (!row && SEEDED_OWNERS.includes(email)) {
      await ctx.db.insert("access", {
        userId,
        email,
        name: user?.name ?? undefined,
        role: "owner",
        screens: ROLE_SCREENS.owner,
      });
    }
    return null;
  },
});
