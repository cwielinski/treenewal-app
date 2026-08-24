import { runTest } from "./auth";

runTest("Marketing", async helper => {
  const { page } = helper;
  page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.setViewportSize({ width: 1440, height: 1200 });
  await helper.goto("/marketing");
  await page.waitForTimeout(8000);
  await helper.screenshot("marketing-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(2500);
  await helper.screenshot("marketing-mobile.png");
}).catch(() => process.exit(1));
