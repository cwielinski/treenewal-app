import { runTest } from "./auth";

runTest("Access", async helper => {
  const { page } = helper;
  page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await helper.goto("/access");
  await page.waitForTimeout(5000);
  await helper.screenshot("access-desktop.png");
}).catch(() => process.exit(1));
