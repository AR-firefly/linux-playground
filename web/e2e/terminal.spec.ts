import { expect, test } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("粘贴只插入一次（不与浏览器默认粘贴叠加）", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText("echo pasted-once"));
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(400);
  const rows = await page.locator(".xterm-rows").innerText();
  expect((rows.match(/echo pasted-once/g) || []).length).toBe(1);
});
