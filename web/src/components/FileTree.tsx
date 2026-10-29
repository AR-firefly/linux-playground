import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { TreeEntry } from "../engine/types";
import { HOME } from "../engine/vfs";

interface FileTreeProps {
  root: TreeEntry;
  cwd: string;
  onOpen: (entry: TreeEntry) => void;
  homePath?: string;
  homeLabel?: string;
}

function TreeNode({
  entry,
  cwd,
  depth,
  onOpen,
  homePath = HOME,
  homeLabel = "player 的家",
}: {
  entry: TreeEntry;
  cwd: string;
  depth: number;
  onOpen: (entry: TreeEntry) => void;
  homePath?: string;
  homeLabel?: string;
}) {
  const initiallyOpen =
    depth === 0 || entry.path === "/home" || entry.path === HOME;
  const [open, setOpen] = useState(initiallyOpen);
  const isDirectory = entry.type === "directory";
  const active = isDirectory && cwd === entry.path;
  const displayName =
    entry.path === homePath
      ? homeLabel
      : entry.path === "/"
        ? "根目录 /"
        : entry.name;

  const activate = () => {
    if (isDirectory) setOpen((value) => value || !active);
    onOpen(entry);
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${active ? "is-current" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
      >
        {isDirectory ? (
          <button
            className="tree-toggle"
            type="button"
            aria-label={open ? `折叠 ${entry.name}` : `展开 ${entry.name}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <button
          className="tree-entry"
          type="button"
          onClick={activate}
          title={`${entry.path} · 点击填入 ${isDirectory ? "cd" : "cat"} 命令`}
        >
          {isDirectory ? (
            open ? (
              <FolderOpen size={16} />
            ) : (
              <Folder size={16} />
            )
          ) : (
            <File size={15} />
          )}
          <span>{displayName}</span>
          {active && <span className="current-dot" aria-label="当前目录" />}
        </button>
      </div>
      {isDirectory &&
        open &&
        entry.children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            cwd={cwd}
            depth={depth + 1}
            onOpen={onOpen}
            homePath={homePath}
            homeLabel={homeLabel}
          />
        ))}
    </div>
  );
}

export default function FileTree({
  root,
  cwd,
  onOpen,
  homePath,
  homeLabel,
}: FileTreeProps) {
  return (
    <div className="file-tree" role="tree" aria-label="虚拟文件树">
      <TreeNode
        entry={root}
        cwd={cwd}
        depth={0}
        onOpen={onOpen}
        homePath={homePath}
        homeLabel={homeLabel}
      />
    </div>
  );
}
