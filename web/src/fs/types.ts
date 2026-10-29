/** 真文件夹模式 · 异步文件系统抽象。路径一律是"以所连文件夹为根"的虚拟绝对路径。 */

export type EntryKind = "file" | "directory";

export interface FsEntry {
  name: string;
  kind: EntryKind;
  size: number;
  mtime: number;
}

export interface StatInfo {
  kind: EntryKind;
  size: number;
  mtime: number;
}

export interface AsyncFs {
  /** 展示用名称，例如文件夹名 */
  readonly label: string;
  /** 连接/导入时是否可用 */
  readonly kind: "folder" | "import";
  list(path: string): Promise<FsEntry[]>;
  stat(path: string): Promise<StatInfo | null>;
  read(path: string): Promise<string>;
  write(path: string, content: string, append: boolean): Promise<void>;
  mkdir(path: string, parents: boolean): Promise<void>;
  touch(path: string): Promise<void>;
  /** 删除 = 移入 .trash（软删除），可再清空 */
  remove(path: string, recursive: boolean, force: boolean): Promise<void>;
  copy(source: string, target: string, recursive: boolean): Promise<void>;
  move(source: string, target: string): Promise<void>;
  /** 清空 .trash；无回收站时为空操作 */
  emptyTrash(): Promise<void>;
}

export class FsError extends Error {}

const normalize = (input: string): string => {
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
};

/** 以 root 为基准解析路径；~ 等于根目录。越界（.. 到根之上）报错。 */
export function resolveVirtual(input: string, cwd: string): string {
  let path = input || ".";
  if (path === "~") path = "/";
  else if (path.startsWith("~/")) path = "/" + path.slice(2);
  if (path.startsWith("/")) {
    const result = normalize(path);
    return result === "" ? "/" : result;
  }
  return normalize(cwd + "/" + path);
}

export function parentOf(
  path: string,
): { parent: string; name: string } | null {
  if (path === "/") return null;
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop()!;
  return { parent: "/" + parts.join("/"), name };
}

export function joinPath(parent: string, name: string): string {
  return parent === "/" ? "/" + name : parent + "/" + name;
}

export function isRoot(path: string): boolean {
  return path === "/";
}
