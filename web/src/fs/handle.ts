import {
  FsError,
  joinPath,
  parentOf,
  resolveVirtual,
  type AsyncFs,
  type FsEntry,
  type StatInfo,
} from "./types";

const TRASH = ".trash";

/** 已连接的本地文件夹（File System Access API）。读写直接落到真实磁盘。 */
export class HandleFs implements AsyncFs {
  readonly kind = "folder" as const;
  readonly label: string;
  private root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
    this.label = root.name || "本地文件夹";
  }

  get handle(): FileSystemDirectoryHandle {
    return this.root;
  }

  private async dirAt(path: string): Promise<FileSystemDirectoryHandle> {
    const absolute = resolveVirtual(path, "/");
    let current = this.root;
    for (const part of absolute.split("/").filter(Boolean)) {
      try {
        current = await current.getDirectoryHandle(part);
      } catch {
        throw new FsError(`Not a directory: ${path}`);
      }
    }
    return current;
  }

  private async fileAt(path: string): Promise<FileSystemFileHandle> {
    const location = parentOf(resolveVirtual(path, "/"));
    if (!location) throw new FsError("Is a directory: /");
    const parent = await this.dirAt(location.parent);
    try {
      return await parent.getFileHandle(location.name);
    } catch {
      throw new FsError(`No such file or directory: ${path}`);
    }
  }

  async list(path: string): Promise<FsEntry[]> {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.dirAt(path);
    } catch {
      return []; // 目录不存在（例如回收站已清空）按空目录处理
    }
    const entries: FsEntry[] = [];
    const isRoot = resolveVirtual(path, "/") === "/";
    for await (const [name, handle] of dir.entries()) {
      if (isRoot && name === TRASH) continue;
      if (handle.kind === "directory") {
        entries.push({ name, kind: "directory", size: 4096, mtime: 0 });
      } else {
        let size = 0;
        let mtime = 0;
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          size = file.size;
          mtime = file.lastModified;
        } catch {
          /* 个别系统上可能读不到元数据，保持 0 */
        }
        entries.push({ name, kind: "file", size, mtime });
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async stat(path: string): Promise<StatInfo | null> {
    const absolute = resolveVirtual(path, "/");
    if (absolute === "/") return { kind: "directory", size: 4096, mtime: 0 };
    try {
      const file = await this.fileAt(absolute);
      const data = await file.getFile();
      return { kind: "file", size: data.size, mtime: data.lastModified };
    } catch {
      try {
        await this.dirAt(absolute);
        return { kind: "directory", size: 4096, mtime: 0 };
      } catch {
        return null;
      }
    }
  }

  async read(path: string): Promise<string> {
    const file = await this.fileAt(path);
    return (await file.getFile()).text();
  }

  async write(path: string, content: string, append: boolean): Promise<void> {
    if (append) {
      let existing = "";
      try {
        existing = await this.read(path);
      } catch {
        existing = "";
      }
      const location = parentOf(resolveVirtual(path, "/"))!;
      const parent = await this.dirAt(location.parent);
      const handle = await parent.getFileHandle(location.name, {
        create: true,
      });
      const stream = await handle.createWritable();
      await stream.write(existing + content);
      await stream.close();
      return;
    }
    const location = parentOf(resolveVirtual(path, "/"))!;
    const parent = await this.dirAt(location.parent);
    const handle = await parent.getFileHandle(location.name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(content);
    await stream.close();
  }

  async mkdir(path: string, parents: boolean): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    if (absolute === "/") throw new FsError("File exists");
    const parts = absolute.split("/").filter(Boolean);
    let current = this.root;
    for (let index = 0; index < parts.length; index += 1) {
      const last = index === parts.length - 1;
      try {
        current = await current.getDirectoryHandle(parts[index], {
          create: parents || last,
        });
      } catch {
        throw new FsError(last ? "File exists" : "No such file or directory");
      }
    }
  }

  async touch(path: string): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    const stat = await this.stat(absolute);
    if (stat?.kind === "directory") throw new FsError("Is a directory");
    if (stat?.kind === "file") {
      const file = await this.fileAt(absolute);
      const stream = await file.createWritable();
      await stream.close();
      return;
    }
    const location = parentOf(absolute)!;
    const parent = await this.dirAt(location.parent);
    const handle = await parent.getFileHandle(location.name, { create: true });
    const stream = await handle.createWritable();
    await stream.close();
  }

  private async copyEntry(
    source: FileSystemHandle,
    targetDir: FileSystemDirectoryHandle,
    name: string,
    recursive: boolean,
  ): Promise<void> {
    if (source.kind === "directory") {
      if (!recursive)
        throw new FsError(`-r not specified; omitting directory '${name}'`);
      const dir = await targetDir.getDirectoryHandle(name, { create: true });
      for await (const [childName, child] of (
        source as FileSystemDirectoryHandle
      ).entries()) {
        await this.copyEntry(child, dir, childName, true);
      }
      return;
    }
    const file = await targetDir.getFileHandle(name, { create: true });
    const stream = await file.createWritable();
    await stream.write(await (source as FileSystemFileHandle).getFile());
    await stream.close();
  }

  private async removeEntry(path: string, recursive: boolean): Promise<void> {
    const location = parentOf(resolveVirtual(path, "/"));
    if (!location) throw new FsError("cannot remove root directory '/'");
    const parent = await this.dirAt(location.parent);
    try {
      await parent.removeEntry(location.name, { recursive });
    } catch {
      throw new FsError(`cannot remove '${path}'`);
    }
  }

  async remove(
    path: string,
    recursive: boolean,
    force: boolean,
  ): Promise<void> {
    const absolute = resolveVirtual(path, "/");
    if (absolute === "/")
      throw new FsError("cannot remove root directory '/'");
    if (absolute === `/${TRASH}`) {
      await this.emptyTrash();
      return;
    }
    const stat = await this.stat(absolute);
    if (!stat) {
      if (force) return;
      throw new FsError("No such file or directory");
    }
    if (stat.kind === "directory" && !recursive)
      throw new FsError("Is a directory");
    let trash: FileSystemDirectoryHandle;
    try {
      trash = await this.root.getDirectoryHandle(TRASH, { create: true });
    } catch {
      // 同名但不是目录：清掉重建，保证回收站可用
      try {
        await this.root.removeEntry(TRASH, { recursive: true });
      } catch {
        /* ignore */
      }
      trash = await this.root.getDirectoryHandle(TRASH, { create: true });
    }
    const name = absolute.split("/").pop()!;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let target = `${stamp}-${name}`;
    let counter = 1;
    while (true) {
      try {
        await trash.getFileHandle(target);
        target = `${stamp}-${name}-${counter++}`;
      } catch {
        try {
          await trash.getDirectoryHandle(target);
          target = `${stamp}-${name}-${counter++}`;
          continue;
        } catch {
          break;
        }
      }
    }
    const source =
      stat.kind === "directory"
        ? await this.dirAt(absolute)
        : await this.fileAt(absolute);
    // 优先用原生 move（Chrome 111+，原子零拷贝）；不支持时退回复制+删除
    if (typeof source.move === "function") {
      try {
        await source.move(trash, target);
        return;
      } catch {
        /* 退回复制实现 */
      }
    }
    try {
      await this.copyEntry(source, trash, target, true);
    } catch (error) {
      try {
        await trash.removeEntry(target, { recursive: true });
      } catch {
        /* 清理失败不阻塞报错 */
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new FsError(`写入回收站失败：${message}`);
    }
    await this.removeEntry(absolute, true);
  }

  async copy(
    source: string,
    target: string,
    recursive: boolean,
  ): Promise<void> {
    const sourceAbs = resolveVirtual(source, "/");
    const stat = await this.stat(sourceAbs);
    if (!stat)
      throw new FsError(`cannot stat '${source}': No such file or directory`);
    let targetAbs = resolveVirtual(target, "/");
    const targetStat = await this.stat(targetAbs);
    if (targetStat?.kind === "directory") {
      targetAbs = joinPath(targetAbs, sourceAbs.split("/").pop()!);
    }
    if (targetAbs === sourceAbs)
      throw new FsError(`'${source}' and '${target}' are the same file`);
    if (targetAbs.startsWith(sourceAbs + "/"))
      throw new FsError(
        `cannot copy a directory, '${source}', into itself, '${target}'`,
      );
    const existing = await this.stat(targetAbs);
    if (existing && existing.kind !== stat.kind) {
      throw new FsError(
        existing.kind === "directory"
          ? `cannot overwrite directory '${target}' with non-directory`
          : `cannot overwrite non-directory '${target}' with directory`,
      );
    }
    const location = parentOf(targetAbs)!;
    const parent = await this.dirAt(location.parent);
    const entry =
      stat.kind === "directory"
        ? await this.dirAt(sourceAbs)
        : await this.fileAt(sourceAbs);
    await this.copyEntry(entry, parent, location.name, recursive);
  }

  async move(source: string, target: string): Promise<void> {
    const sourceAbs = resolveVirtual(source, "/");
    const stat = await this.stat(sourceAbs);
    if (!stat)
      throw new FsError(`cannot stat '${source}': No such file or directory`);
    let targetAbs = resolveVirtual(target, "/");
    const targetStat = await this.stat(targetAbs);
    if (targetStat?.kind === "directory") {
      targetAbs = joinPath(targetAbs, sourceAbs.split("/").pop()!);
    }
    if (targetAbs === sourceAbs) return;
    if (targetAbs.startsWith(sourceAbs + "/"))
      throw new FsError(
        `cannot move '${source}' to a subdirectory of itself, '${target}'`,
      );
    const existing = await this.stat(targetAbs);
    if (existing) {
      if (existing.kind !== stat.kind) {
        throw new FsError(
          existing.kind === "directory"
            ? `cannot overwrite directory '${target}' with non-directory`
            : `cannot overwrite non-directory '${target}' with directory`,
        );
      }
      await this.remove(targetAbs, true, true); // 覆盖前先进回收站
    }
    const location = parentOf(targetAbs)!;
    const parent = await this.dirAt(location.parent);
    const entry =
      stat.kind === "directory"
        ? await this.dirAt(sourceAbs)
        : await this.fileAt(sourceAbs);
    if (typeof entry.move === "function") {
      try {
        await entry.move(parent, location.name);
        return;
      } catch {
        /* 退回复制+删除 */
      }
    }
    await this.copyEntry(entry, parent, location.name, true);
    await this.removeEntry(sourceAbs, true);
  }

  async emptyTrash(): Promise<void> {
    try {
      await this.root.removeEntry(TRASH, { recursive: true });
    } catch {
      /* 没有回收站就是空的 */
    }
  }
}

const DB_NAME = "linux-playground";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, "folder");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

export async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get("folder");
      request.onsuccess = () =>
        resolve((request.result as FileSystemDirectoryHandle) || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  try {
    const descriptor = { mode: "readwrite" as const };
    const current = (await handle.queryPermission?.(descriptor)) || "prompt";
    if (current === "granted") return true;
    if (!request) return false;
    const next = (await handle.requestPermission?.(descriptor)) || "denied";
    return next === "granted";
  } catch {
    return false;
  }
}

export function supportsFolderAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
