import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Refresh hourly during business hours, Central time. The header shows the
 * last refresh time, so the schedule is visible to the people using it.
 * 12:00 to 23:00 UTC covers 7am to 6pm Central.
 */
const crons = cronJobs();

crons.cron(
  "refresh dashboard data hourly during business hours",
  "0 12-23 * * 1-6",
  internal.arbostar.syncAll,
  {},
);

export default crons;
