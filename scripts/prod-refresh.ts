import { runTest } from "./auth";

runTest("Prod refresh", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 900 });
  await helper.goto("/overview");
  await page.waitForTimeout(8000);
  console.log("url:", page.url());
  console.log("buttons:", await page.locator("button").allInnerTexts());
  await page.screenshot({ path: "/tmp/prod.png", fullPage: false });
  const btn = page.locator('button[aria-label="Refresh"]').first();
  await btn.click({ timeout: 10000 });
  await page.waitForTimeout(3000);
  console.log("refresh clicked");
}).catch(e => { console.error(e); process.exit(1); });
