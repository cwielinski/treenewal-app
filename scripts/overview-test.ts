import { runTest } from "./auth";

runTest("Executive Overview", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 900 });
  await helper.goto("/overview");
  await page.waitForTimeout(4000);

  const heading = await page.locator("text=Revenue by service line").isVisible();
  if (!heading) throw new Error("Overview did not render the service line card");

  await helper.screenshot("overview-desktop.png");

  // drill-down
  await page.locator("text=jobs closed, open drill-down").first().click({ timeout: 5000 }).catch(() => {});
  await page.locator("button:has-text('$')").first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await helper.screenshot("overview-drill.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await helper.screenshot("overview-mobile.png");
}).catch(() => process.exit(1));
