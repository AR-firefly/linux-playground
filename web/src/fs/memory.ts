import {
  FsError,
  joinPath,
  parentOf,
  resolveVirtual,
  type AsyncFs,
  type FsEntry,
  type StatInfo,
} from "./types";

interface MemNode {
  kind: "file" | "directory";
  content: string;
  mtime: number;
  children: Map<string, MemNode>;
}

const now = () => Date.now();

const fileNode = (content = ""): MemNode => ({
  kind: "file",
  content,
  mtime: now(),
  children: new Map(),
});

const dirNode = (): MemNode => ({
  kind: "directory",
  content: "",
  mtime: now(),
  children: new Map(),
});

const cloneNode = (node: MemNode): MemNode => {
  if (node.kind === "file") return { ...node, children: new Map() };
  const copy = dirNode();
  copy.mtime = node.mtime;
  node.children.forEach((child, name) =>
    copy.children.set(name, cloneNode(child)),
  );
  return copy;
};

/** 导入的文件夹副本：全部操作在内存里，最后可导出 zip。 */
export class MemoryFs implements AsyncFs {
  readonly kind = "import" as const;
  readonly label: string;
  private root = dirNode();
  trash = 0;

  constructor(label = "导入的文件夹") {
    this.label = label;
    this.root.children.set(".trash", dirNode());
  }

  load(files: { path: string; content: string }[]): void {
    // 导入内容若含同名 .trash 文件，替换为目录，保证回收站可用
    const existingTrash = this.root.children.get(".trash");
    if (existingTrash && existingTrash.kind !== "directory") {
      this.root.children.set(".trash", dirNode());
    }
    for (const file of files) {
      const parts = file.path.split("/").filter(Boolean);
      if (!parts.length) continue;
      let node = this.root;
      for (let index = 0; index < parts.length - 1; index += 1) {
        let next = node.children.get(parts[index]);
        if (!next) {
          next = dirNode();
          node.children.set(parts[index], next);
        }
        if (next.kind !== "directory")
          throw new FsError(`导入失败：${parts[index]} 不是目录`);
        node = next;
      }
      node.children.set(parts[parts.length - 1], fileNode(file.content));
    }
  }

  private find(path: string): MemNode | null {
    const absolute = resolveVirtual(path, "/");
    if (absolute === "/") return this.root;
    let node: MemNode = this.root;
    for (const part of absolute.split("/").filter(Boolean)) {
      const next = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  private require(path: string): MemNode {
    const node = this.find(path);
    if (!node) throw new FsError(`No such file or directory: ${path}`);
    return node;
  }

  private parentDir(path: string): { parent: MemNode; name: string } {
    const location = parentOf(resolveVirtual(path, "/"));
    if (!location) throw new FsError("cannot operate on root");
    const parent = this.require(location.parent);
    if (parent.kind !== "directory")
      throw new FsError(`Not a directory: ${location.parent}`);
    return { parent, name: location.name };
  }

  async list(path: string): Promise<FsEntry[]> {
    const node = this.require(path);
    if (node.kind !== "directory") return [];
    const isRoot = resolveVirtual(path, "/") === "/";
    return [...node.children.entries()]
      .filter(([name]) => !(isRoot && name === ".trash"))
      .map(([name, child]) => ({
        name,
        kind: child.kind,
        size:
          child.kind === "file"
            ? new TextEncoder().encode(child.content).length
            : 4096,
        mtime: child.mtime,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async stat(path: string): Promise<StatInfo | null> {
    const node = this.find(path);
    if (!node) return null;
    return {
      kind: node.kind,
      size:
        node.kind === "file"
          ? new TextEncoder().encode(node.content).length
          : 4096,
      mtime: node.mtime,
    };
  }

  async read(path: string): Promise<string> {
    const node = this.require(path);
    if (node.kind !== "file") throw new FsError(`Is a directory: ${path}`);
    return node.content;
  }

  async write(path: string, content: string, append: boolean): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    const existing = this.find(absolute);
    if (existing) {
      if (existing.kind !== "file")
        throw new FsError(`Is a directory: ${path}`);
      existing.content = append ? existing.content + content : content;
      existing.mtime = now();
      return;
    }
    const { parent, name } = this.parentDir(absolute);
    parent.children.set(name, fileNode(content));
  }

  async mkdir(path: string, parents: boolean): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    if (absolute === "/") throw new FsError("File exists");
    const parts = absolute.split("/").filter(Boolean);
    let node = this.root;
    for (let index = 0; index < parts.length; index += 1) {
      const last = index === parts.length - 1;
      const existing = node.children.get(parts[index]);
      if (existing) {
        if (existing.kind !== "directory")
          throw new FsError(`Not a directory: ${parts[index]}`);
        if (last && !parents) throw new FsError("File exists");
        node = existing;
      } else {
        if (!last && !parents) throw new FsError("No such file or directory");
        const created = dirNode();
        node.children.set(parts[index], created);
        node = created;
      }
    }
  }

  async touch(path: string): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    const existing = this.find(absolute);
    if (existing) {
      if (existing.kind !== "file") throw new FsError("Is a directory");
      existing.mtime = now();
      return;
    }
    const { parent, name } = this.parentDir(absolute);
    parent.children.set(name, fileNode(""));
  }

  async remove(
    path: string,
    recursive: boolean,
    force: boolean,
  ): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    if (absolute === "/") throw new FsError("cannot remove root directory '/'");
    const node = this.find(absolute);
    if (!node) {
      if (force) return;
      throw new FsError("No such file or directory");
    }
    if (node.kind === "directory" && !recursive)
      throw new FsError("Is a directory");
    if (absolute === "/.trash") {
      await this.emptyTrash();
      return;
    }
    const { parent, name } = this.parentDir(absolute);
    // 软删除：移入 .trash/<时间戳>-<名字>；回收站丢失时自动重建
    let trash = this.root.children.get(".trash");
    if (!trash || trash.kind !== "directory") {
      trash = dirNode();
      this.root.children.set(".trash", trash);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let target = `${stamp}-${name}`;
    let counter = 1;
    while (trash.children.has(target)) target = `${stamp}-${name}-${counter++}`;
    trash.children.set(target, node);
    parent.children.delete(name);
  }

  async copy(
    source: string,
    target: string,
    recursive: boolean,
  ): Promise<void> {
    const sourceAbs = resolveVirtual(source, "/");
    const node = this.find(sourceAbs);
    if (!node)
      throw new FsError(`cannot stat '${source}': No such file or directory`);
    if (node.kind === "directory" && !recursive) {
      throw new FsError(`-r not specified; omitting directory '${source}'`);
    }
    let targetAbs = resolveVirtual(target, "/");
    const targetNode = this.find(targetAbs);
    if (targetNode?.kind === "directory") {
      targetAbs = joinPath(targetAbs, sourceAbs.split("/").pop()!);
    }
    if (targetAbs === sourceAbs)
      throw new FsError(`'${source}' and '${target}' are the same file`);
    if (targetAbs.startsWith(sourceAbs + "/"))
      throw new FsError(
        `cannot copy a directory, '${source}', into itself, '${target}'`,
      );
    const { parent, name } = this.parentDir(targetAbs);
    parent.children.set(name, cloneNode(node));
  }

  async move(source: string, target: string): Promise<void> {
    const sourceAbs = resolveVirtual(source, "/");
    if (sourceAbs === "/") throw new FsError("cannot move root directory '/'");
    const node = this.find(sourceAbs);
    if (!node)
      throw new FsError(`cannot stat '${source}': No such file or directory`);
    let targetAbs = resolveVirtual(target, "/");
    const targetNode = this.find(targetAbs);
    if (targetNode?.kind === "directory") {
      targetAbs = joinPath(targetAbs, sourceAbs.split("/").pop()!);
    }
    if (targetAbs === sourceAbs) return;
    if (targetAbs.startsWith(sourceAbs + "/"))
      throw new FsError(
        `cannot move '${source}' to a subdirectory of itself, '${target}'`,
      );
    const existingTarget = this.find(targetAbs);
    if (existingTarget) {
      if (existingTarget.kind !== node.kind) {
        throw new FsError(
          existingTarget.kind === "directory"
            ? `cannot overwrite directory '${target}' with non-directory`
            : `cannot overwrite non-directory '${target}' with directory`,
        );
      }
      await this.remove(targetAbs, true, true); // 覆盖前先进回收站
    }
    const { parent, name } = this.parentDir(targetAbs);
    const sourceParent = this.parentDir(sourceAbs);
    sourceParent.parent.children.delete(sourceParent.name);
    parent.children.set(name, node);
  }

  async emptyTrash(): Promise<void> {
    this.root.children.set(".trash", dirNode());
  }

  /** 导出用：当前完整树（不含 .trash） */
  snapshot(): { path: string; content: string }[] {
    const files: { path: string; content: string }[] = [];
    const walk = (node: MemNode, prefix: string) => {
      node.children.forEach((child, name) => {
        if (prefix === "" && name === ".trash") return;
        const path = prefix ? `${prefix}/${name}` : name;
        if (child.kind === "file") files.push({ path, content: child.content });
        else walk(child, path);
      });
    };
    walk(this.root, "");
    return files;
  }
}
