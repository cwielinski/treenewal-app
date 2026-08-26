import { runTest } from "./auth";

runTest("Chat", async helper => {
  const { page } = helper;
  await page.setViewportSize({ width: 1440, height: 900 });
  await helper.goto("/chat");
  await page.waitForTimeout(3000);
  await helper.screenshot("chat-empty.png");
  await page.locator(".tn-chat-suggestion").first().click();
  await page.waitForTimeout(25000);
  await helper.screenshot("chat-answer.png");
  await page.setViewportSize({ width: 390, height: 840 });
  await page.waitForTimeout(1500);
  await helper.screenshot("chat-mobile.png");
}).catch(() => process.exit(1));
