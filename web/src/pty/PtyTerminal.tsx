import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { dangerousReason, trackInput } from "./danger";
import { ptyUrl } from "./client";
import { countLines, heightForLines } from "../engine/terminalHeight";

export interface PtyTerminalHandle {
  send: (text: string) => void;
  clear: () => void;
  focus: () => void;
  reconnect: () => void;
}

interface PtyTerminalProps {
  token: string;
  confirmDanger: boolean;
  onCwd: (path: string) => void;
  onExit?: () => void;
  onDanger: (line: string, reason: string, proceed: () => void) => void;
}

const PtyTerminal = forwardRef<PtyTerminalHandle, PtyTerminalProps>(
  function PtyTerminal({ token, confirmDanger, onCwd, onExit, onDanger }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const connectRef = useRef<() => void>(() => undefined);
    const applyHeightRef = useRef<() => void>(() => undefined);
    const copyRef = useRef<() => void>(() => undefined);
    const pasteNextRef = useRef(false);
    const linesRef = useRef(0);
    const openedRef = useRef(false);
    const [hasSelection, setHasSelection] = useState(false);
    const [atBottom, setAtBottom] = useState(true);
    const [guestCols, setGuestCols] = useState(0);
    const [status, setStatus] = useState<"connecting" | "open" | "closed">(
      "connecting",
    );
    const shadowRef = useRef({ line: "", trustworthy: true });
    const confirmRef = useRef(confirmDanger);
    const onDangerRef = useRef(onDanger);
    confirmRef.current = confirmDanger;
    onDangerRef.current = onDanger;

    useImperativeHandle(ref, () => ({
      send(text: string) {
        socketRef.current?.send(JSON.stringify({ t: "i", d: text }));
      },
      clear() {
        linesRef.current = 0;
        applyHeightRef.current();
        termRef.current?.write("\x1b[2J\x1b[H");
      },
      focus() {
        termRef.current?.focus();
      },
      reconnect() {
        connectRef.current();
      },
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const term = new XTerm({
        cursorBlink: true,
        convertEol: false,
        scrollback: 5000,
        fontSize: 14,
        fontFamily:
          '"JetBrains Mono", "Cascadia Code", "Noto Sans Mono CJK SC", monospace',
        lineHeight: 1.55,
        letterSpacing: 0.2,
        theme: {
          background: "#0f1b18",
          foreground: "#e9f0e8",
          cursor: "#d8fa72",
          selectionBackground: "rgba(216, 250, 114, 0.25)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      termRef.current = term;

      term.onSelectionChange(() => setHasSelection(term.hasSelection()));
      term.onScroll(() => {
        const buffer = term.buffer.active;
        setAtBottom(buffer.viewportY >= buffer.baseY);
      });

      // 粘贴：Ctrl+V / Ctrl+Shift+V / 右键，都走剪贴板读取
      // 用 bracketed paste 包裹，bash 会把它当作"贴进来的一行"，不会自动执行
      const pasteClipboard = () => {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (!text) return;
            socketRef.current?.send(
              JSON.stringify({ t: "i", d: `\x1b[200~${text}\x1b[201~` }),
            );
          })
          .catch(() => undefined);
      };

      // 复制：Ctrl+C 有选中就复制（不发 SIGINT）；Ctrl+Shift+C 总是复制
      const copySelection = () => {
        const text = term.getSelection();
        if (!text) return false;
        void navigator.clipboard.writeText(text).catch(() => undefined);
        term.clearSelection();
        setHasSelection(false);
        return true;
      };
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const key = event.key.toLowerCase();
        if (event.ctrlKey && event.shiftKey && key === "c") {
          event.preventDefault(); // 阻断浏览器默认复制，避免与我们的复制叠加
          copySelection();
          return false;
        }
        if (event.ctrlKey && !event.shiftKey && key === "c" && term.hasSelection()) {
          event.preventDefault(); // 有选中 = 复制；没有选中仍然要能中断
          copySelection();
          return false;
        }
        // 粘贴：Ctrl+V 与 Ctrl+Shift+V 都粘贴（xterm 默认会把 Ctrl+V 当控制字符发出去）
        if (event.ctrlKey && key === "v") {
          event.preventDefault(); // 阻断浏览器默认粘贴，避免贴两次
          pasteClipboard();
          return false;
        }
        return true;
      });

      // 滚轮只滚终端，不滚浏览器页面（捕获阶段拦下，自己滚 xterm 的视口）
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        // 原生约定：滚轮往下 = 看更新的内容，往上 = 看更早的
        term.scrollLines(event.deltaY > 0 ? 3 : -3);
      };
      host.addEventListener("wheel", onWheel, { passive: false, capture: true });

      // 粘贴靠事件标记，不能靠"数据长度"猜——方向键也是多字节（\x1b[A），
      // 按长度猜会把方向键当成粘贴，bash 就收不到历史键
      const onPasteEvent = () => {
        pasteNextRef.current = true;
      };
      host.addEventListener("paste", onPasteEvent, true);

      // 右键粘贴（和 Windows Terminal 一致）
      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        pasteClipboard();
      };
      host.addEventListener("contextmenu", onContextMenu);

      const applyHeight = () => {
        const shell = shellRef.current;
        if (!shell) return;
        shell.style.height = `${heightForLines(linesRef.current)}px`;
      };
      applyHeightRef.current = applyHeight;
      copyRef.current = () => {
        copySelection();
      };

      let resizeTimer = 0;
      const scheduleFit = () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          try {
            fit.fit();
          } catch {
            return;
          }
          // 每次都发：变的是"实际能显示几列"（滚动条占位变化不会改 term.cols），
          // 只在 term.cols 变化时才发，等于永远发不出修正后的值
          const cols = guestCols();
          setGuestCols(cols);
          socketRef.current?.send(
            JSON.stringify({ t: "r", c: cols, r: term.rows }),
          );
        }, 120);
      };

      // 精确算出"真正能显示多少列"：
      // xterm 的 fit() 不算滚动条占掉的宽度，直接用 term.cols 会多 1~2 列，
      // guest 按多出来的列排版 → 最后几个字被滚动条盖住、并被 xterm 标成折行。
      // 这里用视口的实际可用宽度 ÷ 单字符宽度来算，减去 1 列保险。
      const guestCols = () => {
        const viewport = host.querySelector(".xterm-viewport") as HTMLElement | null;
        if (!viewport) return Math.max(20, term.cols - 2);
        const rows = host.querySelector(".xterm-rows") as HTMLElement | null;
        let cell = 0;
        const spans = rows?.querySelectorAll("span") ?? [];
        for (const span of spans) {
          const text = span.textContent ?? "";
          if (!text.length) continue;
          const width = span.getBoundingClientRect().width;
          if (width > 0) {
            cell = width / text.length;
            break;
          }
        }
        if (!cell) return Math.max(20, term.cols - 2);
        // 留 2 列保险：xterm 的折行标记对"刚好超出 1 列"也很敏感
        return Math.max(20, Math.floor(viewport.clientWidth / cell) - 2);
      };

      const fitNow = () => {
        try {
          fit.fit();
          socketRef.current?.send(
            JSON.stringify({ t: "r", c: guestCols(), r: term.rows }),
          );
        } catch {
          /* 容器尚未布局 */
        }
      };
      requestAnimationFrame(fitNow);

      term.parser.registerOscHandler(7, (payload) => {
        const match = /^file:\/\/[^/]*(\/.*)$/.exec(payload);
        if (match) onCwd(decodeURIComponent(match[1]));
        return false;
      });

      const connect = () => {
        setStatus("connecting");
        const socket = new WebSocket(ptyUrl(token, term.cols, term.rows));
        socketRef.current = socket;
        socket.onopen = () => {
          openedRef.current = true;
          setStatus("open");
          fitNow();
          term.focus();
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data as string) as {
            t: string;
            d?: string;
            code?: number;
          };
          if (message.t === "o" && message.d) {
            linesRef.current += countLines(message.d);
            applyHeight();
            term.write(message.d);
            scheduleFit();
          } else if (message.t === "exit") {
            term.writeln(
              openedRef.current
                ? "\r\n\x1b[90m[会话已结束] shell 退出了，点上方「重连」可以重新连接。\x1b[0m"
                : "\r\n\x1b[90m[没连上本机网关] 确认 npm run real 还在运行，再点「重连」。\x1b[0m",
            );
            setStatus("closed");
            onExit?.();
          }
        };
        socket.onclose = () => {
          setStatus("closed");
          if (!openedRef.current) {
            term.writeln(
              "\r\n\x1b[90m[连不上本机网关] 先确认 npm run real 还在运行，再点「重连」。\x1b[0m",
            );
          }
        };
        socket.onerror = () => setStatus("closed");
      };
      connectRef.current = connect;
      connect();

      term.onData((data) => {
        if (
          !socketRef.current ||
          socketRef.current.readyState !== WebSocket.OPEN
        )
          return;
        // Ctrl+V 已由按键处理接管，这里忽略，避免又发一次 \x16
        if (data === "\x16") return;
        const isEnter = data === "\r";
        if (isEnter) {
          const { line, trustworthy } = shadowRef.current;
          const reason =
            confirmRef.current && trustworthy && line.trim()
              ? dangerousReason(line)
              : null;
          if (reason) {
            onDangerRef.current(line, reason, () => {
              socketRef.current?.send(JSON.stringify({ t: "i", d: "\r" }));
            });
            return; // 暂不发送回车，等用户确认
          }
          shadowRef.current = { line: "", trustworthy: true };
        } else {
          shadowRef.current = trackInput(shadowRef.current, data);
        }
        // 真正的粘贴（textarea 的 paste 事件）才包 bracketed paste，
        // bash 会当作"贴进来的一行"，多行也不会自动执行
        const isPaste = pasteNextRef.current;
        pasteNextRef.current = false;
        const payload = isPaste ? `\x1b[200~${data}\x1b[201~` : data;
        socketRef.current.send(JSON.stringify({ t: "i", d: payload }));
      });
      term.onResize(() => fitNow());

      const onWindowResize = () => fitNow();
      window.addEventListener("resize", onWindowResize);
      return () => {
        host.removeEventListener("paste", onPasteEvent, true);
        host.removeEventListener("contextmenu", onContextMenu);
        host.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
        window.removeEventListener("resize", onWindowResize);
        socketRef.current?.close();
        term.dispose();
        termRef.current = null;
        socketRef.current = null;
      };
    }, [token, onCwd]);

    return (
      <div className="pty-shell" ref={shellRef}>
        <div className="pty-status">
          <span className={`pty-dot ${status}`} />
          {status === "open"
            ? "真终端已连接 · 命令直接在你本机执行"
            : status === "connecting"
              ? "正在连接本机网关…"
              : openedRef.current
                ? "会话已结束"
                : "连不上本机网关"}
          {hasSelection && (
            <button
              type="button"
              className="pty-reconnect"
              onClick={() => copyRef.current()}
            >
              复制选中
            </button>
          )}
          {status === "closed" && (
            <button
              type="button"
              className="pty-reconnect"
              onClick={() => connectRef.current()}
            >
              重连
            </button>
          )}
          {status === "open" && !atBottom && (
            <button
              type="button"
              className="pty-reconnect"
              onClick={() => termRef.current?.scrollToBottom()}
            >
              回到底部
            </button>
          )}
          {status === "open" && (
            <span className="pty-tip">
              Ctrl+C 复制 · Ctrl+V 粘贴
              {guestCols > 0 ? ` · ${guestCols} 列` : ""}
            </span>
          )}
        </div>
        <div className="pty-host" ref={hostRef} />
      </div>
    );
  },
);

export default PtyTerminal;
