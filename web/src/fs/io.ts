import JSZip from "jszip";
import { MemoryFs } from "./memory";

/** 可被导入的最小文件形状（便于测试注入，不依赖真实 FileList）。 */
export interface ImportableFile {
  name: string;
  webkitRelativePath?: string;
  size?: number;
  text(): Promise<string>;
}

const IGNORED = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_FILES = 1500;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** 把 <input webkitdirectory> 选中的文件灌进内存副本。 */
export async function memoryFsFromFiles(
  files: ArrayLike<ImportableFile>,
  label = "导入的文件夹",
): Promise<MemoryFs> {
  const paths: { parts: string[]; file: ImportableFile }[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relative = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    const parts = relative.split("/").filter(Boolean);
    if (!parts.some((part) => IGNORED.has(part))) paths.push({ parts, file });
  }
  // <input webkitdirectory> 会带上所选文件夹名，把它剥掉当根目录
  const first = paths[0]?.parts[0];
  const shared =
    first &&
    paths.every((item) => item.parts.length > 1 && item.parts[0] === first);
  if (paths.length > MAX_FILES) {
    throw new Error(`文件太多（${paths.length} 个，上限 ${MAX_FILES}），请选择更小的目录。`);
  }
  const payload: { path: string; content: string }[] = [];
  let totalBytes = 0;
  for (const item of paths) {
    const parts = shared ? item.parts.slice(1) : item.parts;
    if (item.file.size && totalBytes + item.file.size > MAX_TOTAL_BYTES) {
      throw new Error(
        "文件夹太大（超过 64MB），请选择更小的目录，或用「连接文件夹」模式。",
      );
    }
    const content = await item.file.text();
    totalBytes += item.file.size ?? new TextEncoder().encode(content).length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("文件夹太大（超过 64MB），请选择更小的目录，或用「连接文件夹」模式。");
    }
    payload.push({ path: parts.join("/"), content });
  }
  const fs = new MemoryFs(shared ? first : label);
  fs.load(payload);
  return fs;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: ImportableFile[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({
      name: file.name,
      webkitRelativePath: prefix ? `${prefix}/${file.name}` : file.name,
      text: () => file.text(),
    });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const name = entry.name || prefix;
  const nextPrefix = prefix ? `${prefix}/${name}` : name;
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, nextPrefix, out);
  }
}

/** 拖拽目录导入。 */
export async function memoryFsFromDrop(
  items: DataTransferItemList,
  label = "拖入的文件夹",
): Promise<MemoryFs> {
  const collected: ImportableFile[] = [];
  const roots: FileSystemEntry[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  for (const root of roots) await walkEntry(root, "", collected);
  if (!collected.length) throw new Error("没有读到文件，请拖入一个文件夹");
  return memoryFsFromFiles(collected, roots[0]?.name || label);
}

/** 把当前内存副本导出为 zip 下载。 */
export async function exportMemoryFsZip(fs: MemoryFs): Promise<void> {
  const zip = new JSZip();
  for (const file of fs.snapshot()) {
    zip.file(file.path, file.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fs.label || "linux-playground"}-已整理.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
