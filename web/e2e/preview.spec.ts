import { expect, test, type Page } from "@playwright/test";

const card = (page: Page) => page.locator(".explanation-card");
const input = (page: Page) => page.locator(".xterm-helper-textarea");

test("输入 ls 时先解释，回车才执行", async ({ page }) => {
  await page.goto("/");
  await input(page).focus();
  await page.keyboard.type("ls");

  await expect(card(page)).toHaveAttribute("data-phase", "preview");
  await expect(page.locator(".explanation-kicker")).toContainText("还没执行");
  await expect(page.locator(".explanation-command")).toHaveText("ls");
  await expect(page.locator(".explain-title")).toContainText("列出目录里的内容");
  await expect(page.locator(".explain-hint")).toContainText("按回车才会执行");
  await expect(page.locator(".xterm-rows")).not.toContainText("readme.txt");

  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-phase", "result");
  await expect(page.locator(".xterm-rows")).toContainText("readme.txt");
});

test("rm -rf 在回车前标红并给后果", async ({ page }) => {
  await page.goto("/");
  await input(page).focus();
  await page.keyboard.type("rm -rf 文档");

  await expect(card(page)).toHaveClass(/risk-danger/);
  await expect(page.locator(".explain-title")).toContainText("删除文件或目录");
  await expect(page.locator(".explain-flags")).toContainText("递归");
  await expect(page.locator(".explain-detail")).toContainText("目录");
  await expect(page.locator(".explain-warning")).toContainText("不可恢复");
});

test("覆盖写与 mv 覆盖给黄色警告", async ({ page }) => {
  await page.goto("/");
  await input(page).focus();
  await page.keyboard.type("echo hi > readme.txt");
  await expect(card(page)).toHaveClass(/risk-warn/);
  await expect(page.locator(".explain-detail")).toContainText("覆盖");

  await page.keyboard.press("Control+u");
  await page.keyboard.type("mv data.csv readme.txt");
  await expect(card(page)).toHaveClass(/risk-warn/);
  await expect(page.locator(".explain-warning")).toContainText("覆盖");
});
