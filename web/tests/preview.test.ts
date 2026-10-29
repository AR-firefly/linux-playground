import { describe, expect, it } from "vitest";
import { buildPreview, type PreviewContext } from "../src/engine/preview";

const ctx = (
  files: Record<string, { kind: "file" | "directory"; files?: number; bytes?: number }>,
  home = "/home/player",
): PreviewContext => ({
  cwd: "/home/player",
  home,
  resolve: (path) => {
    if (path === "~") return home;
    if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
    return path.startsWith("/") ? path : `${home}/${path}`;
  },
  probe: async (path) => {
    const hit = files[path];
    if (!hit) return { path, exists: false };
    return { path, exists: true, ...hit };
  },
});

describe("输入即解释", () => {
  it("空输入返回 null", async () => {
    expect(await buildPreview("   ", ctx({}))).toBeNull();
  });

  it("rm -rf 显示目标规模并标红", async () => {
    const preview = await buildPreview(
      "rm -rf 文档",
      ctx({ "/home/player/文档": { kind: "directory", files: 8, bytes: 12288 } }),
    );
    expect(preview?.risk).toBe("danger");
    expect(preview?.detail).toContain("8 个文件");
    expect(preview?.detail).toContain("12.0KB");
    expect(preview?.warning).toContain("不可恢复");
    expect(preview?.flags.map((item) => item.flag)).toEqual(["-r", "-f"]);
  });

  it("rm 普通文件只是警告", async () => {
    const preview = await buildPreview(
      "rm a.txt",
      ctx({ "/home/player/a.txt": { kind: "file", bytes: 10 } }),
    );
    expect(preview?.risk).toBe("warn");
    expect(preview?.detail).toContain("a.txt");
  });

  it("rm 家目录与根目录给专用警告", async () => {
    const home = await buildPreview("rm -rf ~", ctx({}, "/home/player"));
    expect(home?.risk).toBe("danger");
    expect(home?.warning).toContain("家目录");
    const root = await buildPreview("rm -rf /", ctx({}, "/home/player"));
    expect(root?.risk).toBe("danger");
    expect(root?.warning).toContain("根目录");
  });

  it("rm -r 目录即使没有 -f 也标红", async () => {
    const preview = await buildPreview(
      "rm -r 文档",
      ctx({ "/home/player/文档": { kind: "directory", files: 2, bytes: 20 } }),
    );
    expect(preview?.risk).toBe("danger");
  });

  it("cp / mv 覆盖已有文件会警告", async () => {
    const cp = await buildPreview(
      "cp a.txt b.txt",
      ctx({
        "/home/player/a.txt": { kind: "file", bytes: 3 },
        "/home/player/b.txt": { kind: "file", bytes: 9 },
      }),
    );
    expect(cp?.warning).toContain("覆盖");
    const mv = await buildPreview(
      "mv a.txt b.txt",
      ctx({
        "/home/player/a.txt": { kind: "file", bytes: 3 },
        "/home/player/b.txt": { kind: "file", bytes: 9 },
      }),
    );
    expect(mv?.risk).toBe("warn");
  });

  it("重定向 > 标出目标与覆盖风险", async () => {
    const preview = await buildPreview(
      "echo hi > note.txt",
      ctx({ "/home/player/note.txt": { kind: "file", bytes: 4 } }),
    );
    expect(preview?.detail).toContain("note.txt");
    expect(preview?.detail).toContain("覆盖");
  });

  it("目录不存在时给警告", async () => {
    const preview = await buildPreview("cd 不存在", ctx({}));
    expect(preview?.risk).toBe("warn");
    expect(preview?.detail).toContain("不存在");
  });

  it("支持的命令给中文含义，不支持的给提示", async () => {
    expect((await buildPreview("ls", ctx({})))?.title).toContain("列出");
    const unknown = await buildPreview("vim a.txt", ctx({}));
    expect(unknown?.title).toContain("没有 vim");
  });

  it("引号未闭合时不报错，只提示补全", async () => {
    const preview = await buildPreview('echo "hi', ctx({}));
    expect(preview?.title).toContain("引号");
  });
});
