/** 完整 Linux 网关客户端（同源，仅本地页面可用）。 */

export interface PtyHealth {
  name: string;
  pty: "node-pty" | "script" | "script-bsd" | "wsl";
  home: string;
  shell: string;
  token: string;
}

export async function probePty(): Promise<PtyHealth | null> {
  try {
    const response = await fetch("/health", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as PtyHealth & { ok?: boolean };
    if (data.ok && data.name === "linux-playground-pty") return data;
    return null;
  } catch {
    return null;
  }
}

export interface DirEntry {
  name: string;
  kind: "file" | "directory";
  size: number;
  mtime: number;
}

export async function listDir(
  path: string,
  token: string,
): Promise<{ path: string; parent: string; entries: DirEntry[] }> {
  const response = await fetch(`/fs/list?path=${encodeURIComponent(path)}`, {
    headers: { "X-LP-Token": token },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as {
    path: string;
    parent: string;
    entries: DirEntry[];
  };
}

export function ptyUrl(token: string, cols: number, rows: number): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/pty?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;
}
