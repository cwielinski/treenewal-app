import { runTest } from "./auth";

runTest("Cash", async helper => {
  const { page } = helper;
  page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await helper.goto("/cash");
  await page.waitForTimeout(7000);
  await helper.screenshot("cash-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(2500);
  await helper.screenshot("cash-mobile.png");
}).catch(() => process.exit(1));
