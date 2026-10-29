"use strict";
/**
 * 平台差异的纯函数层：Windows(WSL) / macOS / Linux 的路径、参数与输出解析。
 * 这里不 spawn 任何进程，便于在任意平台上用单测覆盖。
 */
const path = require("node:path");

/** wsl.exe 的输出在管道里是 UTF-16LE；含 NUL 时按 UTF-16 解码。 */
function decodeWslText(buf) {
  if (!buf) return "";
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const asLatin = buffer.toString("latin1");
  if (asLatin.includes("\0")) {
    try {
      // wsl.exe 的管道输出是 UTF-16LE；直接按 utf16le 解，不要再 swap（swap 会把字节翻成 BE）
      return buffer.toString("utf16le").replace(/^\uFEFF/, "");
    } catch {
      return asLatin.replace(/\0/g, "");
    }
  }
  return buffer.toString("utf8");
}

/** 解析 `wsl.exe -l -q` 的输出：发行版名 + 默认项（带 * 的那行）。 */
function parseDistroList(text) {
  const names = [];
  let defaultName = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isDefault = line.startsWith("*");
    const name = (isDefault ? line.slice(1) : line).trim();
    if (!name) continue;
    names.push(name);
    if (isDefault) defaultName = name;
  }
  return { names, defaultName };
}

/** 区分路径语义：Windows 盘符 / POSIX 绝对路径 / 相对路径。 */
function classifyPath(input) {
  if (typeof input !== "string" || !input.trim()) return { kind: "invalid" };
  if (/^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\\\")) {
    return { kind: "windows" };
  }
  if (input.startsWith("/")) return { kind: "posix" };
  return { kind: "relative" };
}

/** 按路径语义取父目录：posix 用 posix.dirname，windows 用 win32.dirname。 */
function dirnameFor(kind, input) {
  if (kind === "windows") return path.win32.dirname(input);
  return path.posix.dirname(input);
}

/**
 * 探测 script 的实现：util-linux 支持 -c；BSD 版没有 -c，参数顺序也不同。
 * run(args) → 退出码（由调用方注入，便于测试）。
 */
function detectScriptFlavor(run) {
  if (typeof run !== "function") return "none";
  if (run(["-q", "-c", "true", "/dev/null"]) === 0) return "util-linux";
  if (run(["-q", "/dev/null", "true"]) === 0) return "bsd";
  return "none";
}

/** 按 script 实现拼参数。 */
function buildScriptArgs(flavor, shell) {
  if (flavor === "bsd") return ["-q", "/dev/null", shell];
  return ["-qfc", shell, "/dev/null"];
}

/** 每次提示符前上报当前目录（OSC 7），前端据此更新文件树。 */
function buildPromptHook() {
  return 'printf "\\033]7;file://%s%s\\033\\\\" "$HOSTNAME" "$PWD";';
}

function encodeBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

/**
 * guest 内的 rc 文件内容：先加载用户自己的 ~/.bashrc（保留别名与 PATH），
 * 再挂我们的 OSC7 hook，避免被 bashrc 里的 PROMPT_COMMAND 顶掉。
 */
function buildRcContent() {
  return [
    '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
    // 每次提示符前把 pty 尺寸同步成浏览器窗口的行列数（script 拿不到 winsize）
    'export COLUMNS=$(cat /tmp/lp-cols 2>/dev/null || echo 100) LINES=$(cat /tmp/lp-rows 2>/dev/null || echo 30)',
    'stty cols $(cat /tmp/lp-cols 2>/dev/null || echo 100) rows $(cat /tmp/lp-rows 2>/dev/null || echo 30) 2>/dev/null',
    `PROMPT_COMMAND='${buildPromptHook()}'`,
    "",
  ].join("\n");
}

/**
 * wsl.exe 的参数：rc 内容用 base64 传，避免 Windows→WSL 传参吃掉引号与反斜杠。
 * 用 -e（不是 --），因为 -- 会展开参数里的 $name。
 */
function buildWslArgs({ rcB64, rcPath }) {
  // script -c 只接受一个参数作为整条命令：必须把 "bash --rcfile …" 整体加引号，
  // 否则 --rcfile 会被 script 当成自己的选项（unrecognized option）。
  // 用单引号：Windows→WSL 传参时双引号会被吃掉，单引号能原样到达。
  const command = `printf %s ${rcB64}|base64 -d > ${rcPath} && exec script -qfc 'bash --rcfile ${rcPath}' /dev/null`;
  return ["-e", "bash", "-c", command];
}

/** 解析 GNU find -printf "%y\\t%s\\t%T@\\t%f\\n" 的输出。 */
function parseFindOutput(text) {
  const entries = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const type = parts[0];
    const name = parts.slice(3).join("\t");
    if (!name) continue;
    entries.push({
      name,
      kind: type === "d" ? "directory" : "file",
      size: type === "d" ? 4096 : Number(parts[1]) || 0,
      mtime: Math.round((Number(parts[2]) || 0) * 1000),
    });
  }
  return entries;
}

/** 在 guest 里列目录（GNU find）。 */
function buildFindArgs(target) {
  return [
    "-e",
    "find",
    target,
    "-maxdepth",
    "1",
    "-mindepth",
    "1",
    "-printf",
    "%y\\t%s\\t%T@\\t%f\\n",
  ];
}

module.exports = {
  buildFindArgs,
  buildPromptHook,
  buildRcContent,
  buildScriptArgs,
  buildWslArgs,
  classifyPath,
  decodeWslText,
  detectScriptFlavor,
  dirnameFor,
  encodeBase64,
  parseDistroList,
  parseFindOutput,
};
