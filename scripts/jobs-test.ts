import { runTest } from "./auth";

runTest("Jobs and Backlog", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 1200 });
  await helper.goto("/jobs");
  await page.waitForTimeout(5000);
  await helper.screenshot("jobs-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await helper.screenshot("jobs-mobile.png");
}).catch(() => process.exit(1));
