/**
 * 生成 README 用界面截图（当前代码的真实渲染，非历史遗留图）
 *
 * 用法：node scripts/screenshots.mjs
 * 产出：docs/screenshots/*.png
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../docs/screenshots");
const baseURL = process.env.LP_BASE_URL ?? "http://127.0.0.1:5173";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function typeCommand(page, command) {
  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--force-color-profile=srgb"],
});

// 1) 桌面端：模拟练习 + 输入即解释（preview 阶段）
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 940 },
    deviceScaleFactor: 2,
  });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForSelector(".xterm-helper-textarea");
  await typeCommand(page, "ls -l");
  await typeCommand(page, "cat readme.txt");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(outDir, "01-simulation-preview.png") });
  await page.close();
}

// 2) 桌面端：环境设置弹窗（四种模式）
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 940 },
    deviceScaleFactor: 2,
  });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForSelector(".xterm-helper-textarea");
  await page.getByRole("button", { name: "环境设置" }).click();
  await page.waitForSelector(".settings-modal");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, "02-modes.png") });
  await page.close();
}

// 3) 手机端：响应式布局
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForSelector(".xterm-helper-textea");
  await typeCommand(page, "mkdir -p 练习");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: resolve(outDir, "03-mobile.png"),
    fullPage: true,
  });
  await page.close();
}

await browser.close();
console.log("screenshots done ->", outDir);
