import { runTest } from "./auth";

runTest("Cash forecast", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 1400 });
  await helper.goto("/cash");
  await page.waitForTimeout(6000);
  const s = page.locator("text=Thirteen week cash forecast").first();
  await s.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await helper.screenshot("forecast.png");
}).catch(() => process.exit(1));
