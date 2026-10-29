import { describe, expect, it } from "vitest";
import { memoryFsFromFiles } from "../src/fs/io";

function fakeFile(path: string, content: string, size?: number) {
  return {
    name: path.split("/").pop()!,
    webkitRelativePath: path,
    size,
    text: async () => content,
  };
}

describe("导入副本 · 目录剥离与体积上限", () => {
  it("剥掉 webkitdirectory 的顶层文件夹名", async () => {
    const fs = await memoryFsFromFiles([
      fakeFile("我的项目/a.txt", "a"),
      fakeFile("我的项目/子/b.txt", "b"),
    ]);
    expect(fs.label).toBe("我的项目");
    expect(await fs.read("/a.txt")).toBe("a");
    expect(await fs.read("/子/b.txt")).toBe("b");
  });

  it("超过 64MB 拒绝导入（按字节而非字符）", async () => {
    const big = "汉".repeat(1000);
    const file = fakeFile("大项目/big.txt", big, 70 * 1024 * 1024);
    await expect(memoryFsFromFiles([file])).rejects.toThrow("文件夹太大");
  });

  it("忽略 .git / node_modules", async () => {
    const fs = await memoryFsFromFiles([
      fakeFile("proj/ok.txt", "ok"),
      fakeFile("proj/.git/config", "x"),
      fakeFile("proj/node_modules/x/index.js", "x"),
    ]);
    expect(await fs.read("/ok.txt")).toBe("ok");
    expect(await fs.stat("/.git/config")).toBeNull();
    expect(await fs.stat("/node_modules/x/index.js")).toBeNull();
  });
});
