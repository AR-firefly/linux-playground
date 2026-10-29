import { describe, expect, it } from "vitest";
import { HandleFs } from "../src/fs/handle";

/** 最小 File System Access API 假句柄，用于验证适配器逻辑（不进真实浏览器）。 */

class FakeFile {
  kind = "file" as const;
  name: string;
  content: string;
  constructor(name: string, content = "") {
    this.name = name;
    this.content = content;
  }
  async getFile() {
    return {
      name: this.name,
      size: this.content.length,
      lastModified: 1700000000000,
      text: async () => this.content,
    } as unknown as File;
  }
  async createWritable() {
    return {
      write: async (data: string | BufferSource | Blob) => {
        if (typeof data === "string") this.content = data;
        else if (typeof (data as Blob).text === "function") {
          this.content = await (data as Blob).text();
        } else this.content = "";
      },
      close: async () => undefined,
    };
  }
  async queryPermission() {
    return "granted" as PermissionState;
  }
  async requestPermission() {
    return "granted" as PermissionState;
  }
}

class FakeDir {
  kind = "directory" as const;
  name: string;
  children = new Map<string, FakeDir | FakeFile>();
  constructor(name: string) {
    this.name = name;
  }
  async *entries(): AsyncIterableIterator<[string, FakeDir | FakeFile]> {
    for (const [key, value] of this.children) yield [key, value];
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found) {
      if (found.kind !== "directory") throw new Error("TypeMismatch");
      return found;
    }
    if (!options?.create) throw new Error("NotFound");
    const created = new FakeDir(name);
    this.children.set(name, created);
    return created;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found) {
      if (found.kind !== "file") throw new Error("TypeMismatch");
      return found;
    }
    if (!options?.create) throw new Error("NotFound");
    const created = new FakeFile(name);
    this.children.set(name, created);
    return created;
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const found = this.children.get(name);
    if (!found) throw new Error("NotFound");
    if (found.kind === "directory" && !options?.recursive) {
      throw new Error("NotEmpty");
    }
    this.children.delete(name);
  }
  async queryPermission() {
    return "granted" as PermissionState;
  }
  async requestPermission() {
    return "granted" as PermissionState;
  }
}

function makeFs() {
  const root = new FakeDir("练习");
  root.children.set("readme.txt", new FakeFile("readme.txt", "hello\n"));
  const docs = new FakeDir("文档");
  docs.children.set("笔记.md", new FakeFile("笔记.md", "# hi\n"));
  root.children.set("文档", docs);
  const fs = new HandleFs(root as unknown as FileSystemDirectoryHandle);
  return { root, docs, fs };
}

describe("真实文件夹适配器 · 复查缺陷回归", () => {
  it("R3 rm 根目录直接拒绝，不做任何复制", async () => {
    const { root, fs } = makeFs();
    await expect(fs.remove("/", true, false)).rejects.toThrow("root directory");
    expect(root.children.has("readme.txt")).toBe(true);
  });

  it("R2/R5 rm -r .trash 等价清空，之后 rm 仍可用", async () => {
    const { root, fs } = makeFs();
    await fs.remove("readme.txt", false, false);
    expect(root.children.has(".trash")).toBe(true);
    await fs.remove("/.trash", true, false);
    expect(root.children.has(".trash")).toBe(false);
    await fs.remove("文档/笔记.md", false, false);
    expect(await fs.stat("/文档/笔记.md")).toBeNull();
    expect(root.children.has(".trash")).toBe(true);
  });

  it("R4 mv / cp 到自身子目录被拒绝", async () => {
    const { fs } = makeFs();
    await expect(fs.move("文档", "文档/sub")).rejects.toThrow("subdirectory");
    await expect(fs.copy("文档", "文档/sub", true)).rejects.toThrow(
      "into itself",
    );
    expect(await fs.stat("/文档/笔记.md")).not.toBeNull();
  });

  it("软删除目录：进 .trash 且原位置消失", async () => {
    const { fs } = makeFs();
    await fs.remove("文档", true, false);
    expect(await fs.stat("/文档")).toBeNull();
    const trash = await fs.list("/.trash");
    expect(trash.length).toBe(1);
    expect(trash[0].kind).toBe("directory");
    await fs.emptyTrash();
    expect(await fs.list("/.trash")).toEqual([]);
  });

  it("mv 在文件夹内改名", async () => {
    const { fs } = makeFs();
    await fs.move("readme.txt", "简介.txt");
    expect(await fs.stat("/readme.txt")).toBeNull();
    expect(await fs.read("/简介.txt")).toBe("hello\n");
  });
});

describe("真实文件夹适配器 · 第二轮复查回归", () => {
  it("F6 根目录存在同名 .trash 文件时，rm 自动重建回收站", async () => {
    const root = new FakeDir("练习");
    root.children.set(".trash", new FakeFile(".trash", "x"));
    root.children.set("a.txt", new FakeFile("a.txt", "a"));
    const fs = new HandleFs(root as unknown as FileSystemDirectoryHandle);
    await fs.remove("a.txt", false, false);
    expect(root.children.get(".trash")?.kind).toBe("directory");
    expect(await fs.stat("/a.txt")).toBeNull();
  });
});
