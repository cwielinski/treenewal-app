import { runTest } from "./auth";

runTest("Profit by class", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 1400 });
  await helper.goto("/overview");
  await page.waitForTimeout(5000);
  const section = page.locator("text=Profit by type of work").first();
  await section.scrollIntoViewIfNeeded();
  if (!(await section.isVisible())) throw new Error("class section missing");
  await page.waitForTimeout(1500);
  await helper.screenshot("class-direct.png");
  await page.locator("button:has-text('With overhead')").click();
  await page.waitForTimeout(2500);
  await helper.screenshot("class-overhead.png");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(1500);
  await section.scrollIntoViewIfNeeded();
  await helper.screenshot("class-mobile.png");
}).catch(() => process.exit(1));
