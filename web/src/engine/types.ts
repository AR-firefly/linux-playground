export type NodeType = "file" | "directory";

interface BaseNode {
  type: NodeType;
  mode: number;
  owner: string;
  group: string;
  mtime: number;
}

export interface FileNode extends BaseNode {
  type: "file";
  content: string;
}

export interface DirectoryNode extends BaseNode {
  type: "directory";
  children: Record<string, VfsNode>;
}

export type VfsNode = FileNode | DirectoryNode;

export interface TreeEntry {
  name: string;
  path: string;
  type: NodeType;
  mode: number;
  owner: string;
  group: string;
  size: number;
  mtime: number;
  children?: TreeEntry[];
}

export interface PagerPayload {
  title: string;
  content: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  explanation: string;
  executedCommand: string;
  pager?: PagerPayload;
  /** 真机模式：无法连接本地中转站时为 true */
  offline?: boolean;
}
