"use strict";
/**
 * LinuxPlayground · 完整 Linux 网关
 * 浏览器 ⇄ WebSocket ⇄ PTY ⇄ 你的 shell
 *
 * 只监听 127.0.0.1；/health 下发随机令牌；WebSocket 握手校验令牌与来源。
 * PTY 来源按平台：Linux 用 node-pty 或 util-linux script；macOS 用系统自带 BSD script；
 * Windows 经 wsl.exe 进入 WSL 里的 Linux（Ubuntu 自带 script）。
 */
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { WebSocketServer } = require("ws");
const {
  buildFindArgs,
  buildRcContent,
  buildScriptArgs,
  buildWslArgs,
  classifyPath,
  decodeWslText,
  detectScriptFlavor,
  dirnameFor,
  encodeBase64,
  parseFindOutput,
} = require("./platform");

const VERSION = "2.1.0";
const MAX_ENTRIES = 500;
const IS_WIN = process.platform === "win32";
const IS_DARWIN = process.platform === "darwin";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function corsOrigin(origin, allowedOrigins) {
  if (!origin) return null;
  if (allowedOrigins.includes(origin)) return origin;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))
    return origin;
  return null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function shellPath() {
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
    return process.env.SHELL;
  }
  return IS_DARWIN ? "/bin/zsh" : "/bin/bash";
}

function wslExe() {
  if (!IS_WIN) return null;
  const exe = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "wsl.exe",
  );
  return fs.existsSync(exe) ? exe : null;
}

function runWsl(args) {
  return new Promise((resolve) => {
    const exe = wslExe();
    if (!exe) {
      resolve({ code: 1, stdout: "", stderr: "wsl.exe not found" });
      return;
    }
    let child;
    try {
      child = spawn(exe, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WSL_UTF8: "1" },
      });
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: String(error) });
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) =>
      resolve({ code: 1, stdout: "", stderr: String(error) }),
    );
    child.on("exit", (code) =>
      resolve({
        code: code ?? 0,
        stdout: decodeWslText(Buffer.concat(stdout)),
        stderr: decodeWslText(Buffer.concat(stderr)),
      }),
    );
  });
}

async function wslHome() {
  const result = await runWsl(["-e", "sh", "-lc", 'printf %s "$HOME"']);
  const home = result.stdout.trim();
  return result.code === 0 && home ? home : "";
}

/** 探测系统 script 是 util-linux 版还是 BSD 版（两者参数不通用）。 */
let scriptFlavorCache = null;
function scriptFlavor() {
  if (scriptFlavorCache) return scriptFlavorCache;
  scriptFlavorCache = detectScriptFlavor((args) => {
    try {
      return spawnSync("script", args, { stdio: "ignore" }).status ?? 1;
    } catch {
      return 1;
    }
  });
  return scriptFlavorCache;
}

function hasScript() {
  try {
    return spawnSync("which", ["script"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

function detectPty() {
  if (IS_WIN) return wslExe() ? "wsl" : "none";
  if (IS_DARWIN) return hasScript() ? "script-bsd" : "none";
  try {
    require.resolve("node-pty");
    return "node-pty";
  } catch {
    return hasScript() ? "script" : "none";
  }
}

/** 把浏览器窗口的行列数写进 guest，让 less/readline 用正确的宽度 */
async function writeSizeFiles(cols, rows) {
  if (IS_WIN) {
    await runWsl([
      "-e",
      "sh",
      "-c",
      `printf %s ${cols} > /tmp/lp-cols; printf %s ${rows} > /tmp/lp-rows`,
    ]);
    return;
  }
  try {
    await fsp.writeFile("/tmp/lp-cols", String(cols));
    await fsp.writeFile("/tmp/lp-rows", String(rows));
  } catch {
    /* 写不了就算了，不影响基本功能 */
  }
}

function ptyEnv() {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "C.UTF-8",
    // 每次提示符前上报当前目录（OSC 7），前端据此更新文件树
    PROMPT_COMMAND:
      'export COLUMNS=$(cat /tmp/lp-cols 2>/dev/null || echo 100) LINES=$(cat /tmp/lp-rows 2>/dev/null || echo 30); ' +
      'stty cols $(cat /tmp/lp-cols 2>/dev/null || echo 100) rows $(cat /tmp/lp-rows 2>/dev/null || echo 30) 2>/dev/null; ' +
      'printf "\\033]7;file://%s%s\\033\\\\" "$HOSTNAME" "$PWD";' +
      (process.env.PROMPT_COMMAND || ""),
  };
}

/** 启动失败时给出明确文案，而不是静默退出。 */
function deadSession(mode, message) {
  const exitHandlers = [];
  const dataHandlers = [];
  queueMicrotask(() => {
    dataHandlers.forEach((handler) => handler(`${message}\r\n`));
    exitHandlers.forEach((handler) => handler({ exitCode: 1 }));
  });
  return {
    mode,
    write: () => undefined,
    resize: () => false,
    kill: () => undefined,
    onData: (handler) => dataHandlers.push(handler),
    onExit: (handler) => exitHandlers.push(handler),
  };
}

function pipeSession(child, mode) {
  let alive = true;
  const exitHandlers = [];
  const dataHandlers = [];
  const emit = (chunk) =>
    dataHandlers.forEach((handler) => handler(chunk.toString("utf8")));
  child.stdout.on("data", emit);
  child.stderr.on("data", emit);
  child.on("exit", (code) => {
    alive = false;
    exitHandlers.forEach((handler) => handler({ exitCode: code ?? 0 }));
  });
  child.on("error", (error) => {
    alive = false;
    exitHandlers.forEach((handler) => handler({ exitCode: 1 }));
    dataHandlers.forEach((handler) => handler(`${error.message}\r\n`));
  });
  return {
    mode,
    write: (data) => {
      if (alive) child.stdin.write(data);
    },
    // script 方案拿不到窗口尺寸（stdin 是管道，winsize 为 0×0）
    resize: () => false,
    kill: () => {
      if (alive) child.kill();
    },
    onData: (handler) => dataHandlers.push(handler),
    onExit: (handler) => exitHandlers.push(handler),
  };
}

function createPty(cols, rows) {
  const mode = detectPty();
  void writeSizeFiles(cols, rows);

  if (mode === "wsl") {
    // rc 内容用 base64 传输，避免 Windows→WSL 传参吃掉引号与反斜杠
    const rcB64 = encodeBase64(buildRcContent());
    const rcPath = "/tmp/linux-playground-rc";
    let child;
    try {
      child = spawn(wslExe(), buildWslArgs({ rcB64, rcPath }), {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, WSL_UTF8: "1" },
      });
    } catch (error) {
      return deadSession(mode, `无法启动 wsl.exe：${error.message}`);
    }
    return pipeSession(child, mode);
  }

  if (mode === "node-pty") {
    const nodePty = require("node-pty");
    const pty = nodePty.spawn(shellPath(), [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: os.homedir(),
      env: ptyEnv(),
    });
    return {
      mode,
      write: (data) => pty.write(data),
      resize: (nextCols, nextRows) => {
        pty.resize(nextCols, nextRows);
        return true;
      },
      kill: () => pty.kill(),
      onData: (handler) => pty.onData(handler),
      onExit: (handler) => pty.onExit(handler),
    };
  }

  if (mode === "none") {
    return deadSession(
      mode,
      "没有可用的 PTY。Windows 请安装 WSL：wsl --install -d Ubuntu",
    );
  }

  const flavor = scriptFlavor() === "bsd" ? "bsd" : "util-linux";
  let child;
  try {
    child = spawn("script", buildScriptArgs(flavor, shellPath()), {
      cwd: os.homedir(),
      env: ptyEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return deadSession(mode, `无法启动 script：${error.message}`);
  }
  return pipeSession(child, mode);
}

function createApp(context) {
  const { distDir = null, allowedOrigins = [] } = context;
  const token = crypto.randomBytes(16).toString("hex");
  const ptyMode = detectPty();
  const server = http.createServer(async (req, res) => {
    const origin = corsOrigin(req.headers.origin, allowedOrigins);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-LP-Token",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }
    const sendJson = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    let pathname;
    try {
      pathname = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      sendJson(400, { error: "非法的 URI 编码" });
      return;
    }
    try {
      if (pathname === "/health" && req.method === "GET") {
        const home = IS_WIN ? (await wslHome()) || os.homedir() : os.homedir();
        sendJson(200, {
          ok: true,
          name: "linux-playground-pty",
          version: VERSION,
          platform: process.platform,
          pty: ptyMode,
          home,
          shell: shellPath(),
          token,
        });
        return;
      }

      // 只读目录列表，供文件树使用
      if (pathname === "/fs/list" && req.method === "GET") {
        if (req.headers["x-lp-token"] !== token) {
          sendJson(403, { error: "未授权请求" });
          return;
        }
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const target = url.searchParams.get("path") || os.homedir();
        const kind = classifyPath(target).kind;
        if (kind === "invalid" || kind === "relative") {
          sendJson(400, { error: "需要绝对路径" });
          return;
        }

        // Windows 上 POSIX 路径只能走 WSL，不能回落到本机文件系统
        if (IS_WIN && kind === "posix") {
          const result = await runWsl(buildFindArgs(target));
          if (result.code !== 0) {
            sendJson(502, {
              error: "无法读取 WSL 目录，请确认 WSL 已安装并已启动发行版。",
            });
            return;
          }
          const entries = parseFindOutput(result.stdout)
            .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
            .slice(0, MAX_ENTRIES);
          sendJson(200, {
            path: target,
            parent: dirnameFor("posix", target),
            entries,
          });
          return;
        }

        let stat;
        try {
          stat = await fsp.stat(target);
        } catch {
          sendJson(404, { error: "目录不存在" });
          return;
        }
        if (!stat.isDirectory()) {
          sendJson(400, { error: "不是目录" });
          return;
        }
        const entries = [];
        let dir;
        try {
          dir = await fsp.opendir(target);
        } catch {
          sendJson(404, { error: "目录不存在" });
          return;
        }
        for await (const item of dir) {
          if (entries.length >= MAX_ENTRIES) break;
          let size = 0;
          let mtime = 0;
          try {
            const info = await fsp.stat(path.join(target, item.name));
            size = info.isDirectory() ? 4096 : info.size;
            mtime = info.mtimeMs;
          } catch {
            /* 无权限读取的条目保留 0 */
          }
          entries.push({
            name: item.name,
            kind: item.isDirectory() ? "directory" : "file",
            size,
            mtime,
          });
        }
        entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
        sendJson(200, {
          path: target,
          parent: dirnameFor(kind, target),
          entries,
        });
        return;
      }

      if (req.method === "GET" && distDir) {
        const relative =
          pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const filePath = path.resolve(distDir, relative);
        if (filePath === distDir || filePath.startsWith(distDir + path.sep)) {
          try {
            const content = await fsp.readFile(filePath);
            res.writeHead(200, {
              "Content-Type":
                MIME[path.extname(filePath)] || "application/octet-stream",
              "Cache-Control": "no-cache",
            });
            res.end(content);
            return;
          } catch {
            /* 落到 404 */
          }
        }
      }
      sendJson(404, { error: "Not Found" });
    } catch (error) {
      sendJson(500, {
        error: String(error && error.message ? error.message : error),
      });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }
    if (
      url.pathname !== "/pty" ||
      !safeEqual(url.searchParams.get("token"), token)
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin && !corsOrigin(origin, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const cols = Number(url.searchParams.get("cols")) || 100;
      const rows = Number(url.searchParams.get("rows")) || 30;
      const session = createPty(cols, rows);
      const send = (payload) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
      };
      session.onData((data) => send({ t: "o", d: data }));
      session.onExit(({ exitCode }) => {
        send({ t: "exit", code: exitCode });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
      ws.on("message", (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message.t === "i" && typeof message.d === "string") {
          session.write(message.d);
        } else if (message.t === "r") {
          const nextCols = Math.max(20, Number(message.c) || 100);
          const nextRows = Math.max(5, Number(message.r) || 30);
          void writeSizeFiles(nextCols, nextRows);
          const ok = session.resize(nextCols, nextRows);
          send({ t: "resize", ok });
        }
      });
      ws.on("close", () => session.kill());
      ws.on("error", () => session.kill());
    });
  });

  server.lpToken = token;
  server.lpPty = ptyMode;
  return server;
}

module.exports = {
  VERSION,
  createApp,
  detectPty,
  corsOrigin,
  scriptFlavor,
};
