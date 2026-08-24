import { runTest } from "./auth";

runTest("Job Map", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 900 });
  await helper.goto("/map");
  await page.waitForTimeout(9000);
  await helper.screenshot("map-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(4000);
  await helper.screenshot("map-mobile.png");
}).catch(() => process.exit(1));
