import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Braces,
  ChevronRight,
  Download,
  FolderOpen,
  RotateCcw,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import Terminal, { type TerminalHandle } from "./components/Terminal";
import FileTree from "./components/FileTree";
import ExplanationCard from "./components/ExplanationCard";
import Pager from "./components/Pager";
import SettingsModal, { type PlayMode } from "./components/SettingsModal";
import FolderConsent from "./components/FolderConsent";
import PtyConsent from "./components/PtyConsent";
import ConfirmDialog from "./components/ConfirmDialog";
import FullModeGuide from "./components/FullModeGuide";
import PtyTerminal, { type PtyTerminalHandle } from "./pty/PtyTerminal";
import { listDir, probePty, type PtyHealth } from "./pty/client";
import { Shell, quotePath } from "./engine/shell";
import { splitPrefix } from "./engine/complete";
import {
  buildPreview,
  type Preview,
  type PreviewTarget,
} from "./engine/preview";
import { HOME, nodeSize } from "./engine/vfs";
import type { CommandResult, PagerPayload, TreeEntry } from "./engine/types";
import { FsShell } from "./fs/shell";
import { resolveVirtual } from "./fs/types";
import {
  HandleFs,
  ensurePermission,
  loadHandle,
  saveHandle,
  supportsFolderAccess,
} from "./fs/handle";
import { MemoryFs } from "./fs/memory";
import { buildFsTree } from "./fs/tree";
import {
  exportMemoryFsZip,
  memoryFsFromDrop,
  memoryFsFromFiles,
} from "./fs/io";

function displayPath(cwd: string, home: string): string {
  if (cwd === home) return "~";
  if (home === "/") return "~" + cwd;
  if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
  return cwd;
}

const MODE_LABEL: Record<PlayMode, string> = {
  simulation: "模拟模式",
  folder: "文件夹模式",
  import: "导入副本",
  pty: "完整 Linux",
};

/** 顶部大字按模式切换：每种模式第一眼就知道"这个模式会动我的什么"。 */
const HERO: Record<PlayMode, { title: React.ReactNode; lead: React.ReactNode }> = {
  simulation: {
    title: (
      <>
        放心敲，<em>别怕错。</em>
      </>
    ),
    lead: (
      <>
        不用装系统，不用背厚厚的手册。
        <br />
        从第一个文件夹开始，把 Linux 练明白。
      </>
    ),
  },
  folder: {
    title: (
      <>
        改的是真文件，<em>但删了能找回。</em>
      </>
    ),
    lead: (
      <>
        命令直接作用于你选中的那个文件夹。
        <br />
        删除会移入 .trash，改回原名就能恢复。
      </>
    ),
  },
  import: {
    title: (
      <>
        先在副本里<em>练一遍。</em>
      </>
    ),
    lead: (
      <>
        改动只发生在浏览器内存里。
        <br />
        导出 zip 之后才会落盘。
      </>
    ),
  },
  pty: {
    title: (
      <>
        这是<em>你本机的 shell。</em>
      </>
    ),
    lead: (
      <>
        命令真的在你的机器上执行。
        <br />
        能力边界就是你的账号权限，没有沙箱。
      </>
    ),
  },
};

export default function App() {
  const [shell] = useState(() => new Shell());
  const [tree, setTree] = useState<TreeEntry>(() => shell.vfs.snapshot());
  const [cwd, setCwd] = useState(HOME);
  const [lastCommand, setLastCommand] = useState("");
  const [explanation, setExplanation] = useState("");
  const [line, setLine] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"preview" | "result">("result");
  const [pager, setPager] = useState<PagerPayload | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<PlayMode>("simulation");
  const [consentOpen, setConsentOpen] = useState(false);
  const [folderLabel, setFolderLabel] = useState("本地文件夹");
  const [notice, setNotice] = useState("");
  const [memoryFs, setMemoryFs] = useState<MemoryFs | null>(null);
  const fsShellRef = useRef<FsShell | null>(null);
  const previewSeq = useRef(0);
  const terminalRef = useRef<TerminalHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevKeyRef = useRef<string>("simulation:0");
  const [fsSession, setFsSession] = useState(0);
  const [ptyInfo, setPtyInfo] = useState<PtyHealth | null>(null);
  const [ptyCwd, setPtyCwd] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [ptyConsentOpen, setPtyConsentOpen] = useState(false);
  const [dangerPrompt, setDangerPrompt] = useState<{
    line: string;
    reason: string;
    proceed: () => void;
  } | null>(null);
  const [trashConfirm, setTrashConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "folder" | "import" | "export" | "cmd">(null);
  const [confirmDanger, setConfirmDanger] = useState(
    () => localStorage.getItem("lp-confirm-danger") !== "off",
  );
  const ptyRef = useRef<PtyTerminalHandle>(null);

  const homePath =
    mode === "simulation" ? HOME : mode === "pty" ? ptyInfo?.home || "/" : "/";

  // 模式或文件夹会话变化后才重置终端（挂载时不重置，避免 xterm 初始化竞态）
  useEffect(() => {
    const key = `${mode}:${fsSession}`;
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    if (mode !== "simulation" && !fsShellRef.current) return;
    const nextCwd = mode === "simulation" ? shell.vfs.cwd : "/";
    terminalRef.current?.reset(nextCwd);
    setCwd(nextCwd);
    if (mode === "simulation") {
      setLastCommand("");
      setExplanation("");
    }
  }, [mode, fsSession, shell]);

  const refreshFsTree = useCallback(async (engine: FsShell) => {
    try {
      setTree(await buildFsTree(engine.fs));
    } catch {
      /* 树刷新失败不打断命令流 */
    }
  }, []);

  const showResult = useCallback((command: string, text: string) => {
    previewSeq.current += 1;
    setPreview(null);
    setPhase("result");
    setLastCommand(command);
    setExplanation(text);
  }, []);

  const probeVfs = useCallback(
    async (target: string): Promise<PreviewTarget> => {
      const node = shell.vfs.getNode(target);
      if (!node) return { path: target, exists: false };
      if (node.type === "file") {
        return { path: target, exists: true, kind: "file", bytes: nodeSize(node) };
      }
      let files = 0;
      let bytes = 0;
      const walk = (item: typeof node) => {
        for (const child of Object.values(item.children)) {
          if (child.type === "file") {
            files += 1;
            bytes += nodeSize(child);
          } else walk(child);
        }
      };
      walk(node);
      return { path: target, exists: true, kind: "directory", files, bytes };
    },
    [shell],
  );

  const probeFs = useCallback(async (target: string): Promise<PreviewTarget> => {
    const engine = fsShellRef.current;
    if (!engine) return { path: target, exists: false };
    const stat = await engine.fs.stat(target);
    if (!stat) return { path: target, exists: false };
    if (stat.kind === "file") {
      return { path: target, exists: true, kind: "file", bytes: stat.size };
    }
    let files = 0;
    let bytes = 0;
    let visited = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > 4 || visited > 300) return;
      try {
        for (const entry of await engine.fs.list(dir)) {
          visited += 1;
          if (entry.kind === "file") {
            files += 1;
            bytes += entry.size;
          } else await walk(`${dir === "/" ? "" : dir}/${entry.name}`, depth + 1);
        }
      } catch {
        /* 无权限目录跳过 */
      }
    };
    await walk(target, 0);
    return { path: target, exists: true, kind: "directory", files, bytes };
  }, []);

  useEffect(() => {
    if (!line.trim()) {
      previewSeq.current += 1;
      setPreview(null);
      setPhase("result");
      return;
    }
    setPhase("preview");
    const seq = ++previewSeq.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const isSim = mode === "simulation";
        const engine = fsShellRef.current;
        if (!isSim && !engine) return;
        const next = await buildPreview(line, {
          cwd: isSim ? shell.vfs.cwd : "/",
          home: isSim ? HOME : "/",
          resolve: (path) =>
            isSim
              ? shell.vfs.resolve(path, shell.vfs.cwd)
              : resolveVirtual(path, engine ? engine.cwd : "/"),
          probe: isSim ? probeVfs : probeFs,
        });
        if (seq === previewSeq.current) setPreview(next);
      })();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [line, mode, probeFs, probeVfs, shell]);

  const activateFs = useCallback(async (fs: HandleFs | MemoryFs) => {
    const engine = new FsShell(fs);
    fsShellRef.current = engine;
    setFsSession((value) => value + 1);
    setFolderLabel(fs.label);
    setCwd("/");
    setPager(null);
    setTree(await buildFsTree(fs));
    showResult(
      fs.kind === "folder" ? "连接文件夹" : "导入文件夹",
      fs.kind === "folder"
        ? `已连接真实文件夹「${fs.label}」，读写立刻生效；删除会移入 .trash。`
        : `已导入「${fs.label}」的副本，改动只在浏览器内存里，点「导出 zip」才落盘。`,
    );
  }, []);

  // 探测同源网关（本地页面由网关托管，/health 会返回 PTY 信息）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await probePty();
      if (!cancelled) setPtyInfo(info);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 危险命令确认开关持久化
  useEffect(() => {
    localStorage.setItem("lp-confirm-danger", confirmDanger ? "on" : "off");
  }, [confirmDanger]);

  const loadPtyTree = useCallback(
    async (target: string) => {
      if (!ptyInfo) return;
      try {
        const data = await listDir(target, ptyInfo.token);
        const children: TreeEntry[] = [];
        if (data.parent !== data.path) {
          children.push({
            name: "..",
            path: data.parent,
            type: "directory",
            mode: 0o755,
            owner: "you",
            group: "you",
            size: 4096,
            mtime: Date.now(),
            children: [],
          });
        }
        for (const item of data.entries) {
          children.push({
            name: item.name,
            path: `${data.path === "/" ? "" : data.path}/${item.name}`,
            type: item.kind,
            mode: item.kind === "directory" ? 0o755 : 0o644,
            owner: "you",
            group: "you",
            size: item.size,
            mtime: item.mtime,
            children: item.kind === "directory" ? [] : undefined,
          });
        }
        setTree({
          name: data.path.split("/").filter(Boolean).pop() || "/",
          path: data.path,
          type: "directory",
          mode: 0o755,
          owner: "you",
          group: "you",
          size: 4096,
          mtime: Date.now(),
          children,
        });
        setPtyCwd(data.path);
        setCwd(data.path);
      } catch {
        /* 读不到目录时保持旧树 */
      }
    },
    [ptyInfo],
  );

  const handlePtyCwd = useCallback(
    (target: string) => {
      void loadPtyTree(target);
    },
    [loadPtyTree],
  );

  const connectPty = useCallback(async () => {
    if (!ptyInfo) return;
    setMode("pty");
    setPager(null);
    setLastCommand("完整 Linux");
    setExplanation(
      "真终端已连接：命令直接在你这台机器上执行。左侧文件树跟随 shell 的当前目录。",
    );
    await loadPtyTree(ptyInfo.home);
  }, [loadPtyTree, ptyInfo]);

  // 刷新页面后，如果上次的文件夹仍被授权，静默恢复
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await loadHandle();
      if (!handle || cancelled) return;
      if (!(await ensurePermission(handle, false))) return;
      if (cancelled) return;
      await activateFs(new HandleFs(handle));
      setMode("folder");
      setNotice(`已恢复上次文件夹「${handle.name}」，命令会直接作用于真实文件。`);
    })();
    return () => {
      cancelled = true;
    };
  }, [activateFs]);

  const connectFolder = async () => {
    if (!supportsFolderAccess()) {
      setNotice(
        "当前浏览器不支持直接访问文件夹，请用 Chrome / Edge，或改用「导入文件夹」。",
      );
      return;
    }
    setBusy("folder");
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
        id: "linux-playground",
      });
      if (!(await ensurePermission(handle, true))) {
        setNotice("没有拿到读写权限，保持当前模式。");
        return;
      }
      await saveHandle(handle);
      await activateFs(new HandleFs(handle));
      setMode("folder");
      setNotice("");
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name !== "AbortError") {
        setNotice("选择文件夹失败，请重试，或改用「导入文件夹」。");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSelectMode = (next: PlayMode) => {
    setNotice("");
    setPager(null);
    if (next === "simulation") {
      setMode("simulation");
      fsShellRef.current = null;
      setMemoryFs(null);
      setCwd(shell.vfs.cwd);
      setTree(shell.vfs.snapshot());
      return;
    }
    if (next === "folder") {
      setConsentOpen(true);
      return;
    }
    if (next === "pty") {
      if (ptyInfo) setPtyConsentOpen(true);
      else setGuideOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("import");
    try {
      const label =
        files[0].webkitRelativePath?.split("/")[0] || "导入的文件夹";
      const fs = await memoryFsFromFiles(files, label);
      setMemoryFs(fs);
      await activateFs(fs);
      setMode("import");
    } catch {
      setNotice("导入失败：文件可能太大或无法读取。");
    } finally {
      setBusy(null);
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    if (mode === "folder") {
      setNotice("文件夹模式下不支持拖拽导入；请用「换一个文件夹」。");
      return;
    }
    try {
      const fs = await memoryFsFromDrop(event.dataTransfer.items);
      setMemoryFs(fs);
      await activateFs(fs);
      setMode("import");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "拖入失败");
    }
  };

  const complete = useCallback(
    async (prefix: string): Promise<string[]> => {
      const { dir, base } = splitPrefix(prefix, prefix.length);
      if (mode === "simulation") {
        const dirPath = dir
          ? shell.vfs.resolve(dir, shell.vfs.cwd)
          : shell.vfs.cwd;
        const node = shell.vfs.getNode(dirPath);
        if (!node || node.type !== "directory") return [];
        return Object.entries(node.children)
          .filter(([name]) => name.startsWith(base))
          .map(([name, child]) => `${dir}${name}${child.type === "directory" ? "/" : ""}`)
          .sort();
      }
      const engine = fsShellRef.current;
      if (!engine) return [];
      const dirPath = dir ? resolveVirtual(dir, engine.cwd) : engine.cwd;
      try {
        return (await engine.fs.list(dirPath))
          .filter((entry) => entry.name.startsWith(base))
          .map(
            (entry) =>
              `${dir}${entry.name}${entry.kind === "directory" ? "/" : ""}`,
          )
          .sort();
      } catch {
        return [];
      }
    },
    [mode, shell],
  );

  const handleExecute = useCallback(
    async (command: string): Promise<CommandResult> => {
      const result =
        mode === "simulation"
          ? shell.execute(command)
          : fsShellRef.current
            ? await fsShellRef.current.execute(command)
            : shell.execute(command);
      showResult(command, result.explanation);
      setCwd(result.cwd);
      setPager(result.pager || null);
      if (mode === "simulation") setTree(shell.vfs.snapshot());
      else if (fsShellRef.current) void refreshFsTree(fsShellRef.current);
      return result;
    },
    [mode, refreshFsTree, shell, showResult],
  );

  const openEntry = (entry: TreeEntry) => {
    setPager(null);
    const command = `${entry.type === "directory" ? "cd" : "cat"} ${quotePath(entry.path)}`;
    if (mode === "pty") {
      ptyRef.current?.send(command);
      return;
    }
    terminalRef.current?.fill(command);
  };

  const reset = async () => {
    setPager(null);
    if (mode === "pty") {
      ptyRef.current?.clear();
      showResult("清空终端", "已清屏；shell 会话仍在。");
      return;
    }
    if (mode === "simulation") {
      const result = shell.reset();
      setTree(shell.vfs.snapshot());
      setCwd(result.cwd);
      showResult("reset", result.explanation);
      terminalRef.current?.reset(result.cwd);
      return;
    }
    if (mode === "folder") {
      setTrashConfirm(true);
    }
  };

  const emptyTrash = async () => {
    const engine = fsShellRef.current;
    if (!engine || engine.fs.kind !== "folder") return;
    try {
      await engine.fs.emptyTrash();
      showResult("清空回收站", "已清空所选文件夹里的 .trash。");
      await refreshFsTree(engine);
    } catch {
      setNotice("清空回收站失败，请重试。");
    } finally {
      setTrashConfirm(false);
    }
  };

  const exportZip = async () => {
    if (!memoryFs) return;
    setBusy("export");
    try {
      await exportMemoryFsZip(memoryFs);
      showResult("导出 zip", "已把当前副本打包下载；解压后替换回原文件夹即可。");
    } finally {
      setBusy(null);
    }
  };

  const noticeText =
    mode === "simulation"
      ? "这是简化模拟环境，真机行为以实际为准"
      : mode === "folder"
        ? `真文件模式：命令直接作用于「${folderLabel}」`
        : mode === "pty"
          ? "完整 Linux：命令直接在你的机器上执行，出问题无法撤销"
          : "导入副本：改动只在浏览器里，导出后才落盘";

  return (
    <div
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void handleDrop(event)}
    >
      <header className="site-header reveal reveal-1">
        <a className="brand" href="./" aria-label="LinuxPlayground 首页">
          <span className="brand-mark">
            <TerminalSquare size={24} strokeWidth={2.4} />
          </span>
          <span className="brand-type">
            <strong>
              LINUX<span>PLAYGROUND</span>
            </strong>
            <small>THE NO-FEAR COMMAND LAB</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="mode-badge">
            <span />
            {MODE_LABEL[mode]}
          </span>
          {mode === "simulation" && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                if (ptyInfo) setPtyConsentOpen(true);
                else
                  setNotice(
                    "本机网关还没运行：在项目目录执行 npm run real，然后用浏览器打开 http://127.0.0.1:8765",
                  );
              }}
            >
              {ptyInfo ? "真终端" : "真终端 · 网关未运行"}
            </button>
          )}
          <button
            className="button secondary compact"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} /> 环境设置
          </button>
        </div>
      </header>

      <main>
        <section className="intro reveal reveal-2">
          <div>
            <div className="eyebrow">
              <Braces size={15} /> BROWSER-BASED LINUX PRACTICE
            </div>
            <h1>{HERO[mode].title}</h1>
          </div>
          <p>{HERO[mode].lead}</p>
        </section>

        <div className="simulation-notice reveal reveal-3">
          <AlertTriangle size={16} />
          <strong>{noticeText}</strong>
          <span>
            {mode === "simulation"
              ? "只覆盖日常文件操作"
              : mode === "folder"
                ? "删除会移入 .trash，可清空"
                : mode === "pty"
                  ? ptyInfo?.pty === "node-pty"
                    ? "node-pty · 窗口自适应"
                    : ptyInfo?.pty === "wsl"
                      ? "wsl.exe · WSL 里的 Linux"
                      : ptyInfo?.pty === "script-bsd"
                        ? "macOS script · 零编译"
                        : "script · 零编译"
                  : "所有浏览器可用"}
          </span>
        </div>

        {notice && (
          <div className="offline-banner" role="alert">
            <AlertTriangle size={20} />
            <div>
              <strong>{notice}</strong>
            </div>
            <button
              type="button"
              className="button secondary compact"
              onClick={() => setNotice("")}
            >
              知道了
            </button>
          </div>
        )}

        {mode !== "simulation" && mode !== "pty" && (
          <div className="fs-toolbar">
            {mode === "folder" ? (
              <button
                type="button"
                className="button secondary compact"
                onClick={() => setConsentOpen(true)}
                aria-label="换一个文件夹"
                disabled={busy !== null}
              >
                <FolderOpen size={16} /> 换一个文件夹
              </button>
            ) : (
              <button
                type="button"
                className="button secondary compact"
                onClick={() => void exportZip()}
                aria-label="导出 zip"
                disabled={busy !== null}
              >
                <Download size={16} /> {busy === "export" ? "正在打包…" : "导出 zip"}
              </button>
            )}
            <span className="fs-toolbar-note">
              {mode === "folder"
                ? `当前：${folderLabel}（真实文件）`
                : `当前：${folderLabel}（副本，改动未落盘）`}
            </span>
          </div>
        )}

        <section className="workspace reveal reveal-4">
          <aside className="sidebar">
            <div className="panel-heading">
              <div>
                <span className="panel-index">01</span>
                <h2>文件探险图</h2>
              </div>
              <span className="panel-meta">LIVE TREE</span>
            </div>
            <div className="current-location">
              <span>你在这里</span>
              <div>
                <ChevronRight size={14} />
                <code>{displayPath(mode === "pty" ? ptyCwd || cwd : cwd, homePath)}</code>
              </div>
            </div>
            <FileTree
              root={tree}
              cwd={cwd}
              onOpen={openEntry}
              homePath={homePath}
              homeLabel={mode === "simulation" ? "player 的家" : folderLabel}
            />
            <div className="tree-legend">
              <div>
                <span className="legend-folder" />
                点文件夹 = <code>cd</code>
              </div>
              <div>
                <span className="legend-file" />
                点文件 = <code>cat</code>
              </div>
            </div>
          </aside>

          <div className="terminal-column">
            <div className="terminal-panel">
              <div className="terminal-titlebar">
                <div className="window-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="terminal-title">
                  {mode === "pty" ? "you@localhost" : "player@linux-playground"}
                </span>
                <span className={`terminal-status ${busy ? "is-running" : ""}`}>
                  <span /> {busy ? "RUNNING" : "READY"}
                </span>
              </div>
              <div className="terminal-body">
                {mode === "pty" && ptyInfo ? (
                  <PtyTerminal
                    ref={ptyRef}
                    token={ptyInfo.token}
                    confirmDanger={confirmDanger}
                    onCwd={handlePtyCwd}
                    onDanger={(line, reason, proceed) =>
                      setDangerPrompt({ line, reason, proceed })
                    }
                  />
                ) : (
                  <>
                    <Terminal
                      ref={terminalRef}
                      onExecute={handleExecute}
                      onInput={setLine}
                      complete={complete}
                      onBusyChange={(value) => setBusy(value ? "cmd" : null)}
                      homePath={homePath}
                      variant={mode === "import" ? "import" : mode === "simulation" ? "simulation" : "folder"}
                    />
                    {pager && (
                      <Pager pager={pager} onClose={() => setPager(null)} />
                    )}
                  </>
                )}
              </div>
              <div className="terminal-footer">
                <span>BASH-LIKE / UTF-8</span>
                <span>输入命令后按 Enter 执行</span>
              </div>
            </div>
            <ExplanationCard
              command={lastCommand}
              explanation={explanation}
              phase={phase}
              line={line}
              preview={preview}
              note={
                mode === "simulation"
                  ? "简化说明：文件权限会校验；目录权限本期不校验。"
                  : mode === "folder"
                    ? "真文件：删除会移入 .trash，可在文件管理器里恢复。"
                    : mode === "pty"
                      ? "真终端：命令在你本机执行；危险命令确认可在设置中关闭。"
                      : "副本模式：改动只在浏览器内存，导出 zip 后才落盘。"
              }
            />
          </div>
        </section>

        <section className="bottom-bar reveal reveal-5">
          <div className="reset-copy">
            <RotateCcw size={17} />
            <span>
              <strong>玩坏了也没关系。</strong>{" "}
              {mode === "simulation"
                ? "一键回到最初的练习环境。"
                : mode === "folder"
                  ? "删除只是移入 .trash，随时可以清空。"
                  : mode === "pty"
                    ? "真终端里没有撤销：每条命令都直接生效。"
                    : "副本改坏了，重新导入一次就行。"}
            </span>
          </div>
          {mode === "pty" ? (
            <button
              className="button reset-button"
              type="button"
              onClick={() => void reset()}
              title="清空终端显示（不结束 shell 会话）"
            >
              <RotateCcw size={16} /> 清空终端
            </button>
          ) : mode === "import" ? (
            <button
              className="button reset-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="重新选择一个文件夹导入"
            >
              <FolderOpen size={16} /> 重新导入
            </button>
          ) : (
            <button
              className={`button reset-button ${mode === "folder" ? "danger-solid" : ""}`}
              type="button"
              onClick={() => void reset()}
              title={
                mode === "simulation"
                  ? "还原模拟文件系统"
                  : "删除所选文件夹里的 .trash"
              }
            >
              <RotateCcw size={16} />
              {mode === "simulation" ? "重置模拟环境" : "清空回收站"}
            </button>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <span>LINUXPLAYGROUND / 001</span>
        <span>零安装 · 随时重来 · 真文件也有回收站</span>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="import-input"
        className="hidden-input"
        onChange={(event) => {
          void handleImportFiles(event.target.files);
          event.target.value = "";
        }}
        {...({ webkitdirectory: "true", directory: "true" } as Record<
          string,
          string
        >)}
      />

      <SettingsModal
        open={settingsOpen}
        mode={mode}
        folderSupported={supportsFolderAccess()}
        busy={busy}
        confirmDanger={confirmDanger}
        showDangerToggle={mode === "pty"}
        onToggleConfirm={setConfirmDanger}
        onClose={() => setSettingsOpen(false)}
        onSelect={handleSelectMode}
      />
      <FolderConsent
        open={consentOpen}
        onCancel={() => setConsentOpen(false)}
        onConfirm={() => {
          setConsentOpen(false);
          void connectFolder();
        }}
      />
      <FullModeGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
      <ConfirmDialog
        open={trashConfirm}
        title="清空回收站？"
        lead="所选文件夹里的 .trash 会被永久删除，这一步无法撤销。"
        confirmLabel="确认清空"
        onCancel={() => setTrashConfirm(false)}
        onConfirm={() => void emptyTrash()}
      />

      <PtyConsent
        open={ptyConsentOpen}
        ptyMode={ptyInfo?.pty || "script"}
        confirmDanger={confirmDanger}
        onToggleConfirm={setConfirmDanger}
        onCancel={() => setPtyConsentOpen(false)}
        onConfirm={() => {
          setPtyConsentOpen(false);
          void connectPty();
        }}
      />
      {dangerPrompt && (
        <div className="modal-backdrop">
          <section className="settings-modal consent-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">DANGER</span>
                <h2>这条命令看起来有风险</h2>
              </div>
            </div>
            <p className="guide-lead">
              识别到：<strong>{dangerPrompt.reason}</strong>
            </p>
            <pre className="install-guide"><code>{dangerPrompt.line}</code></pre>
            <p className="guide-lead">
              真实 Linux 不会拦你。确认执行吗？取消将发送 Ctrl-C。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  ptyRef.current?.send("\x03");
                  setDangerPrompt(null);
                }}
              >
                取消并中断
              </button>
              <button
                type="button"
                className="button primary danger"
                onClick={() => {
                  dangerPrompt.proceed();
                  setDangerPrompt(null);
                }}
              >
                仍然执行
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
