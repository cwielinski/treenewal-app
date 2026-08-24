import { v } from "convex/values";
import { internal } from "./_generated/api";
import { authenticatedAction } from "./functions";

/** The header refresh button. Kicks off the same server side sync as the cron. */
export const refreshNow = authenticatedAction({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    await ctx.scheduler.runAfter(0, internal.arbostar.syncAll, {});
    return null;
  },
});
