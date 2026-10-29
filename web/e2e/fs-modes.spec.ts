import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCommand(page: Page, command: string) {
  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await expect(page.locator(".explanation-command")).toHaveText(command);
}

test("连接文件夹：先弹真文件提醒，取消后停在模拟模式", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "环境设置" }).click();
  await page.getByRole("button", { name: /连接文件夹/ }).click();
  await page.getByRole("button", { name: "继续" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("接下来操作的是真文件")).toBeVisible();
  await expect(page.getByText(".trash")).toBeVisible();

  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".mode-badge")).toContainText("模拟模式");
});

test("导入副本：导入 → 命令真实作用于副本 → 导出 zip", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "环境设置" }).click();
  await page.getByRole("button", { name: /导入文件夹/ }).click();
  await page.getByRole("button", { name: "选择要导入的文件夹" }).click();

  const importDir = mkdtempSync(join(tmpdir(), "lp-import-"));
  writeFileSync(join(importDir, "readme.txt"), "hello 导入\n");
  writeFileSync(join(importDir, "data.csv"), "a,b\n1,2\n");
  await page.getByTestId("import-input").setInputFiles(importDir);

  await expect(page.locator(".mode-badge")).toContainText("导入副本");
  await expect(page.locator(".intro h1")).toContainText("先在副本里");
  await expect(page.locator(".current-location code")).toHaveText("~");
  await expect(page.locator(".fs-toolbar")).toContainText("副本，改动未落盘");

  await runCommand(page, "ls");
  await expect(page.locator(".xterm-rows")).toContainText("readme.txt");
  await expect(page.locator(".xterm-rows")).toContainText("data.csv");

  await runCommand(page, "cat readme.txt");
  await expect(page.locator(".xterm-rows")).toContainText("hello 导入");

  await runCommand(page, "echo 新文件 > note.txt");
  await runCommand(page, "ls");
  await expect(page.locator(".xterm-rows")).toContainText("note.txt");

  await runCommand(page, "rm data.csv");
  await expect(page.getByTitle("/data.csv · 点击填入 cat 命令")).toHaveCount(0);

  await runCommand(page, "vim readme.txt");
  await expect(page.locator(".xterm-rows")).toContainText("此模式暂不支持");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 zip" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".zip");
  await expect(page.locator(".explanation-command")).toHaveText("导出 zip");
});

test("文件夹模式的文件树来自所选目录（假句柄注入）", async ({ page }) => {
  await page.addInitScript(() => {
    const file = (name: string, content: string) => ({
      kind: "file",
      name,
      getFile: async () =>
        new File([content], name, { lastModified: Date.now() }),
      createWritable: async () => {
        let data = content;
        return {
          write: async (value: string) => {
            data = value;
          },
          close: async () => undefined,
        };
      },
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
    });
    const dir = (name: string, children: Record<string, unknown>): any => ({
      kind: "directory",
      name,
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      entries: async function* () {
        for (const [key, value] of Object.entries(children)) {
          yield [key, value];
        }
      },
      getDirectoryHandle: async (
        child: string,
        options?: { create?: boolean },
      ) => {
        if (children[child]) return children[child];
        if (options?.create) {
          const created = dir(child, {});
          children[child] = created;
          return created;
        }
        throw new DOMException("not found", "NotFoundError");
      },
      getFileHandle: async (child: string, options?: { create?: boolean }) => {
        if (children[child]) return children[child];
        if (options?.create) {
          const created = file(child, "");
          children[child] = created;
          return created;
        }
        throw new DOMException("not found", "NotFoundError");
      },
      removeEntry: async (child: string) => {
        delete children[child];
      },
    });
    const root = dir("我的练习", {
      "readme.txt": file("readme.txt", "来自真实文件夹\n"),
      文档: dir("文档", {
        "笔记.md": file("笔记.md", "# 真实笔记\n"),
      }),
    });
    (window as any).showDirectoryPicker = async () => root;
  });

  await page.goto("/");
  await page.getByRole("button", { name: "环境设置" }).click();
  await page.getByRole("button", { name: /连接文件夹/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "我已知晓，选择文件夹" }).click();

  await expect(page.locator(".mode-badge")).toContainText("文件夹模式");
  // 顶部大字随模式切换
  await expect(page.locator(".intro h1")).toContainText("改的是真文件");
  await expect(page.locator(".fs-toolbar")).toContainText("真实文件");
  await expect(page.locator(".fs-toolbar-note")).toContainText("我的练习");

  await runCommand(page, "ls");
  await expect(page.locator(".xterm-rows")).toContainText("readme.txt");

  await runCommand(page, "cat readme.txt");
  await expect(page.locator(".xterm-rows")).toContainText("来自真实文件夹");

  await runCommand(page, "cd 文档");
  await expect(page.locator(".current-location code")).toHaveText("~/文档");
  await runCommand(page, "ls");
  await expect(page.locator(".xterm-rows")).toContainText("笔记.md");

  await runCommand(page, "cd ..");
  await runCommand(page, "rm readme.txt");
  await expect(page.getByTitle("/readme.txt · 点击填入 cat 命令")).toHaveCount(0);

  await page.getByRole("button", { name: "清空回收站" }).click();
  await expect(page.getByRole("dialog")).toContainText("清空回收站？");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "清空回收站" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.locator(".explanation-command")).toHaveText("清空回收站");
});

test("换一个文件夹后，终端提示符同步回到 ~", async ({ page }) => {
  await page.addInitScript(() => {
    const file = (name: string, content: string) => ({
      kind: "file",
      name,
      getFile: async () => new File([content], name, { lastModified: 1 }),
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
    });
    const dir = (name: string, children: Record<string, unknown>): any => ({
      kind: "directory",
      name,
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      entries: async function* () {
        for (const [key, value] of Object.entries(children)) yield [key, value];
      },
      getDirectoryHandle: async (child: string, options?: { create?: boolean }) => {
        if (children[child]) return children[child];
        if (options?.create) {
          const created = dir(child, {});
          children[child] = created;
          return created;
        }
        throw new DOMException("not found", "NotFoundError");
      },
      getFileHandle: async (child: string, options?: { create?: boolean }) => {
        if (children[child]) return children[child];
        if (options?.create) {
          const created = file(child, "");
          children[child] = created;
          return created;
        }
        throw new DOMException("not found", "NotFoundError");
      },
      removeEntry: async (child: string) => {
        delete children[child];
      },
    });
    const rootA = dir("文件夹A", {
      "readme.txt": file("readme.txt", "A\n"),
      "文档": dir("文档", { "a.md": file("a.md", "A\n") }),
    });
    const rootB = dir("文件夹B", {
      "readme.txt": file("readme.txt", "B\n"),
    });
    let calls = 0;
    (window as any).showDirectoryPicker = async () => {
      calls += 1;
      return calls === 1 ? rootA : rootB;
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "环境设置" }).click();
  await page.getByRole("button", { name: /连接文件夹/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "我已知晓，选择文件夹" }).click();
  await expect(page.locator(".fs-toolbar-note")).toContainText("文件夹A");

  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("cd 文档");
  await page.keyboard.press("Enter");
  await expect(page.locator(".current-location code")).toHaveText("~/文档");
  await expect(page.locator(".xterm-rows")).toContainText("you@playground:~/文档");

  await page.getByRole("button", { name: "换一个文件夹" }).click();
  await page.getByRole("button", { name: "我已知晓，选择文件夹" }).click();
  await expect(page.locator(".fs-toolbar-note")).toContainText("文件夹B");
  await expect(page.locator(".current-location code")).toHaveText("~");
  await expect(page.locator(".xterm-rows")).toContainText("you@playground:~$");
});

test("线上页面点完整 Linux 会给出本机启动说明", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "环境设置" }).click();
  await page.getByRole("button", { name: /完整 Linux（真终端）/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByText("完整 Linux 需要在本机启动一个组件")).toBeVisible();
  await expect(page.getByText("npm run real")).toBeVisible();
  await expect(page.getByText("wsl --install -d Ubuntu")).toBeVisible();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.locator(".mode-badge")).toContainText("模拟模式");
});
