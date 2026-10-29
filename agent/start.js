"use strict";
/**
 * LinuxPlayground · 完整 Linux 网关启动器
 *
 *   npm run real                 # 默认端口 8765，自动打开浏览器
 *   npm run real -- --port 9000
 *   npm run real -- --no-open
 *
 * 支持：Linux（原生）、macOS（系统自带 script）、Windows（经 wsl.exe 进入 WSL）。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { createApp, VERSION, detectPty } = require("./server");
const { decodeWslText, parseDistroList } = require("./platform");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "web", "dist");
const PUBLISHED_ORIGIN = "https://linux-playground.app.workbuddy.host";
const IS_WIN = process.platform === "win32";
const IS_DARWIN = process.platform === "darwin";

/** 读取当前 commit，便于一眼确认跑的是哪次代码。 */
function gitCommit() {
  try {
    const out = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    return out.status === 0 ? String(out.stdout || "").trim() : "";
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const options = { port: 8765, open: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--no-open") options.open = false;
  }
  return options;
}

function wslExePath() {
  if (!IS_WIN) return null;
  const exe = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "wsl.exe",
  );
  return fs.existsSync(exe) ? exe : null;
}

/** 探测 WSL：需要有发行版，且有默认发行版（wsl.exe -l -q 的 * 标记）。 */
function wslStatus() {
  if (!IS_WIN) return { available: false, names: [], defaultName: null };
  const exe = wslExePath();
  if (!exe) return { available: false, names: [], defaultName: null };
  try {
    const out = spawnSync(exe, ["-l", "-q"], {
      env: { ...process.env, WSL_UTF8: "1" },
    });
    if (out.status !== 0) {
      return { available: false, names: [], defaultName: null };
    }
    const text = decodeWslText(out.stdout);
    const { names, defaultName } = parseDistroList(text);
    // 有发行版即可用；默认项缺失时 wsl.exe -e 会自己报错，我们据此提示
    return {
      available: names.length > 0,
      names,
      defaultName,
    };
  } catch {
    return { available: false, names: [], defaultName: null };
  }
}

function hasCommand(name) {
  try {
    return spawnSync("which", [name], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

function checkEnvironment() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    console.error(`✗ 需要 Node.js ≥ 18（当前 ${process.version}）。`);
    console.error("  Ubuntu/Debian: sudo apt install nodejs npm");
    console.error("  Fedora:        sudo dnf install nodejs");
    console.error("  Arch:          sudo pacman -S nodejs npm");
    process.exit(1);
  }

  if (IS_WIN) {
    const wsl = wslStatus();
    if (wsl.available) {
      console.log(
        `  ✓ 检测到 WSL（${wsl.defaultName || wsl.names.join(", ")}）：将通过 wsl.exe 连接它，无需在 Linux 里装 Node`,
      );
    } else {
      console.error("✗ 没有检测到可用的 WSL，完整 Linux 模式需要 Linux 内核。");
      console.error("");
      console.error("  安装 Ubuntu（只需一次，管理员终端）：");
      console.error("       wsl --install -d Ubuntu");
      console.error("  装完重启，按提示设置用户名密码，再运行 npm run real。");
      console.error("");
      console.error(
        "  不想装 Linux？浏览器里的模拟练习、连接文件夹、导入副本都不需要安装。",
      );
      process.exit(1);
    }
    return;
  }

  if (IS_DARWIN) {
    if (!hasCommand("script")) {
      console.error("✗ macOS 缺少系统命令 script，无法提供 PTY。");
      process.exit(1);
    }
    console.log("  ✓ macOS：用系统自带 script 提供 PTY（零安装）");
    return;
  }

  if (!hasCommand("script")) {
    console.error(
      "✗ 缺少系统命令 script（util-linux）。请先安装：sudo apt install util-linux",
    );
    process.exit(1);
  }
}

async function ensureDist() {
  if (fs.existsSync(path.join(DIST_DIR, "index.html"))) return;
  console.log("· 首次运行，正在构建前端（web/）…");
  const install = spawnSync(
    "npm",
    ["--prefix", path.join(PROJECT_ROOT, "web"), "install"],
    { stdio: "inherit" },
  );
  if (install.status !== 0) {
    console.error("✗ npm install 失败");
    process.exit(1);
  }
  const build = spawnSync(
    "npm",
    ["--prefix", path.join(PROJECT_ROOT, "web"), "run", "build"],
    { stdio: "inherit" },
  );
  if (build.status !== 0) {
    console.error("✗ 前端构建失败");
    process.exit(1);
  }
}

function openBrowser(url) {
  const candidates = IS_WIN
    ? ["cmd.exe", ["/c", "start", "", url]]
    : IS_DARWIN
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(candidates[0], candidates[1], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* 打不开就让用户手动复制地址 */
  }
}

async function listen(server, port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = port + attempt;
    const ok = await new Promise((resolve) => {
      const onError = (error) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else {
          console.error("✗ 启动失败：", error.message);
          process.exit(1);
        }
      };
      server.once("error", onError);
      server.listen(candidate, "127.0.0.1", () => {
        server.off("error", onError);
        resolve(true);
      });
    });
    if (ok) return candidate;
  }
  console.error("✗ 8765–8884 端口均被占用，请用 --port 指定其他端口。");
  process.exit(1);
}

async function main() {
  console.log(`\n  LINUXPLAYGROUND / 完整 Linux 网关 v${VERSION}\n`);
  checkEnvironment();
  const options = parseArgs(process.argv.slice(2));
  const ptyMode = detectPty();
  const ptyText =
    ptyMode === "node-pty"
      ? "node-pty（完整终端，窗口自适应）"
      : ptyMode === "wsl"
        ? "wsl.exe → WSL 里的 script（无需在 Linux 里装 Node）"
        : ptyMode === "script-bsd"
          ? "macOS 系统 script（零安装；全屏程序尺寸固定）"
          : ptyMode === "script"
            ? "script（零编译；vim/top 等全屏程序尺寸固定）"
            : "不可用（缺少 WSL 或 script）";
  console.log(`  ✓ PTY：${ptyText}`);
  const commit = gitCommit();
  console.log(
    `  ✓ 网关版本：v${VERSION}${commit ? ` · commit ${commit}` : "（非 git 仓库）"}`,
  );
  if (ptyMode === "script") {
    console.log(
      "    升级完全体：sudo apt install build-essential python3 && npm install node-pty",
    );
  }
  if (ptyMode === "none") {
    console.error(
      "✗ 没有可用的 PTY。Windows 请安装 WSL：wsl --install -d Ubuntu",
    );
    process.exit(1);
  }
  await ensureDist();

  const server = createApp({
    distDir: DIST_DIR,
    allowedOrigins: [PUBLISHED_ORIGIN],
  });
  const port = await listen(server, options.port);
  const url = `http://127.0.0.1:${port}`;
  console.log("  ✓ 网关已启动：只监听本机，令牌校验已开启");
  console.log(`  ✓ 在浏览器打开： ${url}`);
  console.log(`  ✓ 你的家目录： ${os.homedir()}`);
  console.log(
    "\n  打开网页 → 环境设置 → 完整 Linux → 我已知晓，即可直接敲命令。",
  );
  console.log("  按 Ctrl+C 停止。\n");
  if (options.open) openBrowser(url);
}

main().catch((error) => {
  console.error("✗ 启动失败：", error);
  process.exit(1);
});
