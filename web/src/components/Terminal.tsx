import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { CommandResult } from "../engine/types";
import { HOME } from "../engine/vfs";
import { countLines, heightForLines } from "../engine/terminalHeight";
import {
  applyCompletion,
  displayWidth,
  emptyLine,
  reduceKey,
  type LineState,
} from "../engine/lineedit";

export interface TerminalHandle {
  runCommand: (command: string) => void;
  fill: (text: string) => void;
  reset: (cwd: string) => void;
  focus: () => void;
}

interface TerminalProps {
  onExecute: (command: string) => Promise<CommandResult>;
  onInput?: (line: string) => void;
  complete?: (prefix: string) => Promise<string[]>;
  onBusyChange?: (busy: boolean) => void;
  homePath?: string;
  variant?: "simulation" | "folder" | "import";
}

function shortPath(path: string, home: string): string {
  if (path === home) return "~";
  if (home === "/") return "~" + path;
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

function writeBlock(
  term: XTerm,
  value: string,
  color?: string,
  write?: (text: string) => void,
): void {
  if (!value) return;
  const normalized = value.replace(/\r?\n$/, "").replace(/\r?\n/g, "\r\n");
  if (color) (write ?? ((text: string) => term.write(text)))(`\x1b[${color}m`);
  if (write) write(normalized);
  else term.writeln(normalized);
  if (color) (write ?? ((text: string) => term.write(text)))("\x1b[0m");
  if (write) write("\r\n");
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  {
    onExecute,
    onInput,
    complete,
    onBusyChange,
    homePath = HOME,
    variant = "simulation",
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const cwdRef = useRef(HOME);
  const busyRef = useRef(false);
  const executeRef = useRef(onExecute);
  const onInputRef = useRef(onInput);
  const completeRef = useRef(complete);
  const busyChangeRef = useRef(onBusyChange);
  const homePathRef = useRef(homePath);
  const variantRef = useRef(variant);
  const stateRef = useRef<LineState>(emptyLine());
  const runRef = useRef<(command: string) => void>(() => undefined);
  const fillRef = useRef<(text: string) => void>(() => undefined);
  const resetRef = useRef<(cwd: string) => void>(() => undefined);
  executeRef.current = onExecute;
  onInputRef.current = onInput;
  completeRef.current = complete;
  busyChangeRef.current = onBusyChange;
  homePathRef.current = homePath;
  variantRef.current = variant;

  useImperativeHandle(ref, () => ({
    runCommand: (command) => runRef.current(command),
    fill: (text) => fillRef.current(text),
    reset: (cwd) => resetRef.current(cwd),
    focus: () => termRef.current?.focus(),
  }));

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", "Noto Sans Mono CJK SC", monospace',
      fontSize: 14,
      lineHeight: 1.55,
      letterSpacing: 0.2,
      scrollback: 1500,
      convertEol: false,
      theme: {
        background: "#132220",
        foreground: "#e9f0e8",
        cursor: "#d8fa72",
        cursorAccent: "#132220",
        selectionBackground: "#536a4d",
        black: "#132220",
        red: "#ff907d",
        green: "#d8fa72",
        yellow: "#f2c66d",
        blue: "#8ab6ff",
        magenta: "#d2a9e8",
        cyan: "#7bd9cb",
        white: "#e9f0e8",
        brightBlack: "#73837d",
        brightRed: "#ffab99",
        brightGreen: "#e5ff9c",
        brightYellow: "#ffda8a",
        brightBlue: "#abcaff",
        brightMagenta: "#e2c2f2",
        brightCyan: "#a2eee2",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    requestAnimationFrame(() => fit.fit());

    let writtenLines = 0;
    const applyHeight = () => {
      const host = hostRef.current;
      if (!host) return;
      host.style.height = `${heightForLines(writtenLines)}px`;
    };
    const write = (text: string) => {
      writtenLines += countLines(text);
      term.write(text);
    };
    const writeLine = (text: string) => {
      writtenLines += countLines(text) + 1;
      term.writeln(text);
    };

    const promptText = () => {
      const user = variantRef.current === "simulation" ? "player" : "you";
      return `\x1b[32m${user}@playground\x1b[0m:\x1b[34m${shortPath(
        cwdRef.current,
        homePathRef.current,
      )}\x1b[0m$ `;
    };

    const renderLine = () => {
      const state = stateRef.current;
      term.write("\r\x1b[K");
      write(promptText());
      write(state.line);
      const tail = displayWidth(state.line.slice(state.cursor));
      if (tail > 0) term.write(`\x1b[${tail}D`);
    };

    const notifyInput = () => {
      onInputRef.current?.(stateRef.current.line);
    };

    const setBusy = (value: boolean) => {
      busyRef.current = value;
      busyChangeRef.current?.(value);
    };

    const run = async (command: string, alreadyEchoed = false) => {
      if (busyRef.current || !command.trim()) {
        if (!alreadyEchoed && !command.trim()) renderLine();
        return;
      }
      setBusy(true);
      if (!alreadyEchoed) term.writeln(command);
      let pagerOpened = false;
      try {
        const result = await executeRef.current(command);
        pagerOpened = Boolean(result.pager);
        cwdRef.current = result.cwd;
        writeBlock(term, result.stdout, undefined, write);
        writeBlock(term, result.stderr, "31", write);
      } catch {
        writeBlock(term, "命令执行时遇到问题，请再试一次。", "31");
      } finally {
        setBusy(false);
        renderLine();
        applyHeight();
        if (!pagerOpened) term.focus();
      }
    };
    runRef.current = (command) => {
      stateRef.current = { ...stateRef.current, line: "", cursor: 0 };
      void run(command);
    };
    fillRef.current = (text) => {
      stateRef.current = {
        ...stateRef.current,
        line: text,
        cursor: text.length,
        historyIndex: -1,
      };
      renderLine();
      notifyInput();
      term.focus();
    };

    const welcome = () => {
      if (variantRef.current === "folder") {
        writeLine("\x1b[1;32m  LINUXPLAYGROUND / 真文件终端\x1b[0m");
        writeLine(
          "\x1b[90m  命令作用于你选择的文件夹；删除会移入 .trash。\x1b[0m",
        );
      } else if (variantRef.current === "import") {
        writeLine("\x1b[1;32m  LINUXPLAYGROUND / 副本终端\x1b[0m");
        writeLine(
          "\x1b[90m  改动只发生在浏览器内存里，点「导出 zip」后才落盘。\x1b[0m",
        );
      } else {
        writeLine("\x1b[1;32m  LINUXPLAYGROUND / 模拟终端\x1b[0m");
        writeLine(
          "\x1b[90m  输入 ls 试试。每一次错误，都不会伤害你的电脑。\x1b[0m",
        );
      }
      writeLine("");
    };
    welcome();
    renderLine();
    applyHeight();
    resetRef.current = (nextCwd) => {
      cwdRef.current = nextCwd;
      busyRef.current = false;
      stateRef.current = { ...stateRef.current, line: "", cursor: 0 };
      writtenLines = 0;
      term.reset();
      welcome();
      renderLine();
      applyHeight();
      notifyInput();
      term.focus();
    };

    term.onData((data) => {
      if (busyRef.current) return;
      // Ctrl+V 已由按键处理接管，避免再插一次
      if (data === "\x16") return;

      // 有选中文本时 Ctrl+C 复制，不发送中断
      if (data === "\u0003" && term.hasSelection()) {
        void navigator.clipboard
          .writeText(term.getSelection())
          .catch(() => undefined);
        term.clearSelection();
        renderLine();
        return;
      }

      const { state, action } = reduceKey(stateRef.current, data);
      stateRef.current = state;

      switch (action.type) {
        case "submit":
          term.write("\r\n");
          notifyInput();
          void run(action.command, true);
          return;
        case "interrupt":
          write("^C");
          renderLine();
          applyHeight();
          notifyInput();
          return;
        case "eof":
          writeLine("");
          writeLine(
            "\x1b[90m（已收到 Ctrl+D；模拟环境里输入命令即可继续）\x1b[0m",
          );
          renderLine();
          applyHeight();
          notifyInput();
          return;
        case "clear-screen":
          term.clear();
          writtenLines = 0;
          renderLine();
          applyHeight();
          return;
        case "paste":
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (!text) return;
              const next = reduceKey(stateRef.current, text);
              stateRef.current = next.state;
              renderLine();
              notifyInput();
            })
            .catch(() => undefined);
          return;
        case "complete": {
          const prefix = action.prefix;
          void (async () => {
            const candidates = completeRef.current
              ? await completeRef.current(prefix)
              : [];
            const applied = applyCompletion(
              stateRef.current,
              prefix,
              candidates,
            );
            stateRef.current = applied.state;
            if (applied.listing.length) {
              write("\r\n");
              writeLine(applied.listing.join("  "));
            }
            renderLine();
            applyHeight();
            notifyInput();
          })();
          return;
        }
        default:
          renderLine();
          notifyInput();
      }
    });

    // 滚轮只滚终端内容，不带动浏览器页面
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // 原生约定：滚轮往下 = 看更新的内容，往上 = 看更早的
      term.scrollLines(event.deltaY > 0 ? 3 : -3);
    };
    hostRef.current?.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });

    // 复制：Ctrl+Shift+C 总是复制选区（和真终端一致）
    // 粘贴：Ctrl+V 读剪贴板插入到光标处（xterm 默认会把 Ctrl+V 当控制字符）
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && event.shiftKey && key === "c") {
        event.preventDefault(); // 阻断浏览器默认复制，避免叠加
        const text = term.getSelection();
        if (text) {
          void navigator.clipboard.writeText(text).catch(() => undefined);
          term.clearSelection();
        }
        return false;
      }
      if (event.ctrlKey && !event.shiftKey && key === "c" && term.hasSelection()) {
        event.preventDefault(); // 有选中 = 复制；没有选中仍然走中断
        const text = term.getSelection();
        if (text) {
          void navigator.clipboard.writeText(text).catch(() => undefined);
          term.clearSelection();
          renderLine();
        }
        return false;
      }
      if (event.ctrlKey && key === "v") {
        event.preventDefault(); // 阻断浏览器默认粘贴，避免贴两次
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (!text) return;
            const next = reduceKey(stateRef.current, text);
            stateRef.current = next.state;
            renderLine();
            notifyInput();
          })
          .catch(() => undefined);
        return false;
      }
      return true;
    });

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(hostRef.current);
    return () => {
      resizeObserver.disconnect();
      hostRef.current?.removeEventListener("wheel", onWheel, {
        capture: true,
      } as EventListenerOptions);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  return (
    <div
      className="terminal-canvas"
      ref={hostRef}
      aria-label="可输入命令的 Linux 模拟终端"
    />
  );
});

export default Terminal;
