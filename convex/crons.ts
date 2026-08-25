import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Refresh twice a day, before the day starts and after it ends, Central
 * time. The header shows the last refresh time and carries a manual
 * refresh button for anyone who wants the numbers sooner.
 * 10:00 and 23:00 UTC cover 5am and 6pm Central.
 */
const crons = cronJobs();

crons.cron(
  "refresh dashboard data at 5am Central",
  "0 10 * * *",
  internal.arbostar.syncAll,
  {},
);

crons.cron(
  "refresh dashboard data at 6pm Central",
  "0 23 * * *",
  internal.arbostar.syncAll,
  {},
);

export default crons;
