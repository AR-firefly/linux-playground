import type { DirectoryNode, FileNode, TreeEntry, VfsNode } from "./types";

export const HOME = "/home/player";
const PLAYER = "player";
const now = () => Date.now();

export function file(content = "", mode = 0o644): FileNode {
  return {
    type: "file",
    content,
    mode,
    owner: PLAYER,
    group: PLAYER,
    mtime: now(),
  };
}

export function directory(
  children: Record<string, VfsNode> = {},
  mode = 0o755,
): DirectoryNode {
  return {
    type: "directory",
    children,
    mode,
    owner: PLAYER,
    group: PLAYER,
    mtime: now(),
  };
}

export function nodeSize(node: VfsNode): number {
  return node.type === "directory"
    ? 4096
    : new TextEncoder().encode(node.content).length;
}

export function modeString(node: VfsNode): string {
  const prefix = node.type === "directory" ? "d" : "-";
  const bits = [0o400, 0o200, 0o100, 0o40, 0o20, 0o10, 0o4, 0o2, 0o1];
  const chars = ["r", "w", "x", "r", "w", "x", "r", "w", "x"];
  return (
    prefix +
    bits.map((bit, index) => (node.mode & bit ? chars[index] : "-")).join("")
  );
}

export function isReadable(node: VfsNode): boolean {
  return Boolean(node.mode & 0o400);
}

export function isWritable(node: VfsNode): boolean {
  return Boolean(node.mode & 0o200);
}

export function cloneNode(node: VfsNode): VfsNode {
  if (node.type === "file") return { ...node };
  const children: Record<string, VfsNode> = {};
  Object.entries(node.children).forEach(([name, child]) => {
    children[name] = cloneNode(child);
  });
  return { ...node, children };
}

function initialTree(): DirectoryNode {
  return directory({
    home: directory({
      player: directory({
        "readme.txt": file(
          "欢迎来到 LinuxPlayground！\n\n这里是一个可以放心试错的 Linux 练习角落。\n试试 ls -l 看看文件详情，或用 cat readme.txt 阅读我。\n\n小提示：点击左侧文件，也会自动执行 cat。\n",
        ),
        "data.csv": file("name,score,team\nAda,98,A\nLinus,95,B\nGrace,99,A\n"),
        ".notes": file("隐藏文件也能被 ls -a 找到。\n"),
        文档: directory({
          "学习笔记.md": file(
            "# Linux 学习笔记\n\npwd：看看我在哪\nls：看看这里有什么\ncd：去另一个文件夹\ncat：读一个文件\nmkdir：建一个文件夹\n\n重复练习，比死记硬背更有用。\n",
          ),
          "命令速查.txt": file(
            '列出文件：ls -l\n查找文字：grep -n 关键词 文件名\n查找文件：find . -name "*.txt"\n',
          ),
          "旧笔记.txt": file("这一页可以随便改写、复制或删除。\n"),
          "长文练习.txt": file(
            Array.from(
              { length: 48 },
              (_, index) =>
                `第 ${String(index + 1).padStart(2, "0")} 行：慢慢读，按方向键翻页；输入 / 可以搜索这一行。`,
            ).join("\n") + "\n",
          ),
        }),
        图片: directory({
          "说明.txt": file("这里预置的是练习用说明文件，没有真实图片。\n"),
        }),
        练习区: directory({
          "poem.txt": file("Stay hungry.\nStay foolish.\nKeep learning.\n"),
        }),
      }),
    }),
    etc: directory({
      hostname: file("linux-playground\n"),
      "motd.txt": file("欢迎回来，player。今天也放心敲命令吧。\n"),
    }),
    usr: directory({
      bin: directory({}),
    }),
    tmp: directory({}),
  });
}

export class VirtualFileSystem {
  root: DirectoryNode = initialTree();
  cwd = HOME;

  reset(): void {
    this.root = initialTree();
    this.cwd = HOME;
  }

  resolve(input = ".", from = this.cwd): string {
    let path = input || ".";
    if (path === "~") path = HOME;
    else if (path.startsWith("~/")) path = HOME + path.slice(1);
    const parts = path.startsWith("/") ? [] : from.split("/").filter(Boolean);
    path.split("/").forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
    return "/" + parts.join("/");
  }

  getNode(path: string, from = this.cwd): VfsNode | null {
    const absolute = this.resolve(path, from);
    if (absolute === "/") return this.root;
    let current: VfsNode = this.root;
    for (const part of absolute.split("/").filter(Boolean)) {
      if (current.type !== "directory") return null;
      const next: VfsNode | undefined = current.children[part];
      if (!next) return null;
      current = next;
    }
    return current;
  }

  getParent(
    path: string,
  ): { parent: DirectoryNode; name: string; absolute: string } | null {
    const absolute = this.resolve(path);
    if (absolute === "/") return null;
    const parts = absolute.split("/").filter(Boolean);
    const name = parts.pop()!;
    const parent = this.getNode("/" + parts.join("/"));
    if (!parent || parent.type !== "directory") return null;
    return { parent, name, absolute };
  }

  mkdir(path: string, parents: boolean): void {
    const absolute = this.resolve(path);
    if (absolute === "/")
      throw new Error(`mkdir: cannot create directory '${path}': File exists`);
    const parts = absolute.split("/").filter(Boolean);
    let current = this.root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const last = index === parts.length - 1;
      const existing = current.children[part];
      if (existing) {
        if (existing.type !== "directory") {
          throw new Error(
            `mkdir: cannot create directory '${path}': Not a directory`,
          );
        }
        if (last) {
          if (parents) return;
          throw new Error(
            `mkdir: cannot create directory '${path}': File exists`,
          );
        }
        current = existing;
      } else {
        if (!last && !parents) {
          throw new Error(
            `mkdir: cannot create directory '${path}': No such file or directory`,
          );
        }
        const created = directory();
        current.children[part] = created;
        current = created;
      }
    }
    this.root.mtime = now();
  }

  touch(path: string): void {
    const existing = this.getNode(path);
    if (existing) {
      if (existing.type === "directory")
        throw new Error(`touch: cannot touch '${path}': Is a directory`);
      if (!isWritable(existing))
        throw new Error(`touch: cannot touch '${path}': Permission denied`);
      existing.mtime = now();
      return;
    }
    const location = this.getParent(path);
    if (!location)
      throw new Error(
        `touch: cannot touch '${path}': No such file or directory`,
      );
    location.parent.children[location.name] = file();
  }

  write(path: string, content: string, append: boolean): void {
    const existing = this.getNode(path);
    if (existing) {
      if (existing.type === "directory")
        throw new Error(`write: '${path}': Is a directory`);
      if (!isWritable(existing))
        throw new Error(`write: '${path}': Permission denied`);
      existing.content = append ? existing.content + content : content;
      existing.mtime = now();
      return;
    }
    const location = this.getParent(path);
    if (!location)
      throw new Error(`write: '${path}': No such file or directory`);
    location.parent.children[location.name] = file(content);
  }

  remove(path: string, recursive: boolean, force: boolean): void {
    const absolute = this.resolve(path);
    const node = this.getNode(absolute);
    if (!node) {
      if (!force)
        throw new Error(
          `rm: cannot remove '${path}': No such file or directory`,
        );
      return;
    }
    if (absolute === "/")
      throw new Error("rm: cannot remove root directory '/'");
    if (node.type === "directory" && !recursive) {
      throw new Error(`rm: cannot remove '${path}': Is a directory`);
    }
    const location = this.getParent(absolute)!;
    delete location.parent.children[location.name];
  }

  copy(sourcePath: string, targetPath: string, recursive: boolean): void {
    const source = this.getNode(sourcePath);
    if (!source)
      throw new Error(
        `cp: cannot stat '${sourcePath}': No such file or directory`,
      );
    if (source.type === "directory" && !recursive) {
      throw new Error(
        `cp: -r not specified; omitting directory '${sourcePath}'`,
      );
    }
    const sourceAbsolute = this.resolve(sourcePath);
    let targetAbsolute = this.resolve(targetPath);
    let target = this.getNode(targetAbsolute);
    if (target?.type === "directory") {
      targetAbsolute = this.resolve(
        sourceAbsolute.split("/").pop()!,
        targetAbsolute,
      );
      target = this.getNode(targetAbsolute);
    }
    if (sourceAbsolute === targetAbsolute) {
      throw new Error(
        `cp: '${sourcePath}' and '${targetPath}' are the same file`,
      );
    }
    if (
      source.type === "directory" &&
      targetAbsolute.startsWith(sourceAbsolute + "/")
    ) {
      throw new Error(
        `cp: cannot copy a directory, '${sourcePath}', into itself, '${targetPath}'`,
      );
    }
    if (target) {
      if (target.type === "directory" || source.type !== target.type) {
        throw new Error(
          `cp: cannot overwrite directory '${targetPath}' with non-directory`,
        );
      }
      if (!isWritable(target))
        throw new Error(
          `cp: cannot create regular file '${targetPath}': Permission denied`,
        );
    }
    const location = this.getParent(targetAbsolute);
    if (!location)
      throw new Error(
        `cp: cannot create regular file '${targetPath}': No such file or directory`,
      );
    location.parent.children[location.name] = cloneNode(source);
  }

  move(sourcePath: string, targetPath: string): void {
    const sourceAbsolute = this.resolve(sourcePath);
    const source = this.getNode(sourceAbsolute);
    if (!source)
      throw new Error(
        `mv: cannot stat '${sourcePath}': No such file or directory`,
      );
    if (sourceAbsolute === "/")
      throw new Error("mv: cannot move root directory '/'");
    let targetAbsolute = this.resolve(targetPath);
    let target = this.getNode(targetAbsolute);
    if (target?.type === "directory") {
      targetAbsolute = this.resolve(
        sourceAbsolute.split("/").pop()!,
        targetAbsolute,
      );
      target = this.getNode(targetAbsolute);
    }
    if (sourceAbsolute === targetAbsolute) return;
    if (
      source.type === "directory" &&
      targetAbsolute.startsWith(sourceAbsolute + "/")
    ) {
      throw new Error(
        `mv: cannot move '${sourcePath}' to a subdirectory of itself, '${targetPath}'`,
      );
    }
    if (target) {
      if (!isWritable(target))
        throw new Error(
          `mv: cannot move '${sourcePath}' to '${targetPath}': Permission denied`,
        );
      if (target.type === "directory" && source.type !== "directory") {
        throw new Error(
          `mv: cannot overwrite directory '${targetPath}' with non-directory`,
        );
      }
    }
    const sourceLocation = this.getParent(sourceAbsolute)!;
    const targetLocation = this.getParent(targetAbsolute);
    if (!targetLocation)
      throw new Error(
        `mv: cannot move '${sourcePath}' to '${targetPath}': No such file or directory`,
      );
    delete sourceLocation.parent.children[sourceLocation.name];
    targetLocation.parent.children[targetLocation.name] = source;
  }

  snapshot(): TreeEntry {
    const build = (name: string, path: string, node: VfsNode): TreeEntry => {
      const entry: TreeEntry = {
        name,
        path,
        type: node.type,
        mode: node.mode,
        owner: node.owner,
        group: node.group,
        size: nodeSize(node),
        mtime: node.mtime,
      };
      if (node.type === "directory") {
        entry.children = Object.entries(node.children)
          .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
          .map(([childName, child]) =>
            build(childName, this.resolve(childName, path), child),
          );
      }
      return entry;
    };
    return build("/", "/", this.root);
  }
}
