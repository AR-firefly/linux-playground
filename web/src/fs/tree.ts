import type { TreeEntry } from "../engine/types";
import { joinPath, type AsyncFs } from "./types";

const MAX_DEPTH = 6;
const MAX_DIRS = 150;

/** 把真实/导入的文件夹读成与模拟版同构的文件树（深度与目录数有上限）。 */
export async function buildFsTree(fs: AsyncFs): Promise<TreeEntry> {
  const root: TreeEntry = {
    name: fs.label,
    path: "/",
    type: "directory",
    mode: 0o755,
    owner: "you",
    group: "you",
    size: 4096,
    mtime: Date.now(),
    children: [],
  };
  const queue: { entry: TreeEntry; depth: number }[] = [
    { entry: root, depth: 0 },
  ];
  let dirs = 0;
  while (queue.length && dirs < MAX_DIRS) {
    const { entry, depth } = queue.shift()!;
    dirs += 1;
    const children: TreeEntry[] = [];
    try {
      for (const item of await fs.list(entry.path)) {
        const child: TreeEntry = {
          name: item.name,
          path: joinPath(entry.path, item.name),
          type: item.kind,
          mode: item.kind === "directory" ? 0o755 : 0o644,
          owner: "you",
          group: "you",
          size: item.size,
          mtime: item.mtime,
          children: item.kind === "directory" ? [] : undefined,
        };
        children.push(child);
        if (item.kind === "directory" && depth + 1 < MAX_DEPTH) {
          queue.push({ entry: child, depth: depth + 1 });
        }
      }
    } catch {
      /* 个别目录无权限读取时跳过 */
    }
    entry.children = children;
  }
  return root;
}
