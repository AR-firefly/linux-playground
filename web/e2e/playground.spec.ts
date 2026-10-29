import { expect, test, type Page } from "@playwright/test";

async function runCommand(page: Page, command: string) {
  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await expect(page.locator(".explanation-command")).toHaveText(command);
}

test("模拟终端、文件树、分页和重置形成完整闭环", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "放心敲，别怕错。" }),
  ).toBeVisible();
  await expect(
    page.getByText("这是简化模拟环境，真机行为以实际为准", { exact: true }),
  ).toBeVisible();

  await runCommand(page, "pwd");
  await expect(page.locator(".xterm-rows")).toContainText("/home/player");
  await expect(page.locator(".explanation-card")).toContainText("告诉你现在");

  await runCommand(page, "echo hello > note.txt");
  await runCommand(page, "cat note.txt");
  await expect(page.locator(".xterm-rows")).toContainText("hello");
  await page.getByTitle("/home/player/note.txt · 点击填入 cat 命令").click();
  await expect(page.locator(".explanation-card")).toHaveAttribute(
    "data-phase",
    "preview",
  );
  await expect(page.locator(".explanation-command")).toHaveText(
    "cat /home/player/note.txt",
  );
  await expect(page.locator(".current-location code")).toHaveText("~");
  await page.keyboard.press("Enter");
  await expect(page.locator(".explanation-card")).toHaveAttribute(
    "data-phase",
    "result",
  );
  await expect(page.locator(".xterm-rows")).toContainText(
    "cat /home/player/note.txt",
  );
  await expect(page.locator(".xterm-rows")).toContainText("hello");

  await page.getByTitle("/home/player/文档 · 点击填入 cd 命令").click();
  await expect(page.locator(".current-location code")).toHaveText("~");
  await page.keyboard.press("Enter");
  await expect(page.locator(".current-location code")).toHaveText("~/文档");

  await runCommand(page, "less /home/player/文档/长文练习.txt");
  await expect(page.locator(".pager")).toBeVisible();
  await expect(page.locator(".pager-status")).toContainText("第 1 /");
  await page.keyboard.press("PageDown");
  await expect(page.locator(".pager-status")).toContainText("第 2 /");
  await page.keyboard.press("/");
  await page.getByRole("textbox", { name: "分页搜索" }).fill("第 48 行");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pager-content")).toContainText("第 48 行");
  await page.keyboard.press("q");
  await expect(page.locator(".pager")).toHaveCount(0);

  await runCommand(page, "vim note.txt");
  await expect(page.locator(".xterm-rows")).toContainText("简化版暂不支持");
  await page.getByRole("button", { name: "重置模拟环境" }).click();
  await expect(page.locator(".current-location code")).toHaveText("~");
  await expect(
    page.getByTitle("/home/player/note.txt · 点击填入 cat 命令"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
});

test("手机布局无横向溢出且设置可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "放心敲，别怕错。" }),
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  await page.getByRole("button", { name: "环境设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /完整 Linux（真终端）/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
});
