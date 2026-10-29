import {
  HOME,
  isReadable,
  modeString,
  nodeSize,
  VirtualFileSystem,
} from "./vfs";
import type { CommandResult, DirectoryNode, VfsNode } from "./types";

export interface Token {
  value: string;
  quoted: boolean;
}

export interface Segment {
  name: string;
  args: string[];
  stdoutTarget?: { path: string; append: boolean };
  stderrTarget?: string;
}

export const COMMANDS = new Set([
  "pwd",
  "ls",
  "cd",
  "cat",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "rm",
  "less",
  "chmod",
  "echo",
  "grep",
  "find",
  "which",
  "whereis",
]);

const COMMAND_PATHS = Object.fromEntries(
  [...COMMANDS].map((command) => [command, `/usr/bin/${command}`]),
);

export const EXPLANATIONS: Record<string, string> = {
  pwd: "pwd = 告诉你现在正站在哪个文件夹里。",
  ls: "ls = 列出文件夹里有什么；加上选项还能看到更多细节。",
  cd: "cd = 去另一个文件夹，当前位置也会随之改变。",
  cat: "cat = 把一个文件的内容直接读出来。",
  mkdir: "mkdir = 新建一个文件夹；-p 会把缺少的上层一起补齐。",
  touch: "touch = 新建一个空文件；文件已存在时只更新它的修改时间。",
  cp: "cp = 复制一份文件或目录，原来的内容还留着。",
  mv: "mv = 把文件挪到别处，也可以用它改名。",
  rm: "rm = 直接删除文件；-r 用于目录，这里没有回收站。",
  less: "less = 一页一页读长文件；按 / 搜索，按 q 退出。",
  chmod: "chmod = 修改文件的读、写、执行权限。",
  echo: "echo = 输出一段文字；配合 > 或 >> 可以把它写进文件。",
  grep: "grep = 从文字里挑出包含指定内容的部分。",
  find: "find = 按文件名里的通配符，在目录中找文件。",
  which: "which = 查一条命令在系统中的可执行文件位置。",
  whereis: "whereis = 查命令相关的文件位置。",
};

export function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let value = "";
  let quoted = false;
  let quote = "";
  const push = () => {
    if (value || quoted) tokens.push({ value, quoted });
    value = "";
    quoted = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && quote === '"' && index + 1 < input.length) {
        value += input[++index];
        quoted = true;
      } else {
        value += char;
        quoted = true;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
      continue;
    }
    if (char === "\\" && index + 1 < input.length) {
      value += input[++index];
      quoted = true;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if (char === "&") {
      push();
      tokens.push({ value: "&", quoted: false });
      continue;
    }
    if (char === "|") {
      push();
      tokens.push({ value: "|", quoted: false });
      continue;
    }
    if (char === "2" && !value && input[index + 1] === ">") {
      push();
      tokens.push({ value: "2>", quoted: false });
      index += 1;
      continue;
    }
    if (char === ">") {
      push();
      if (input[index + 1] === ">") {
        tokens.push({ value: ">>", quoted: false });
        index += 1;
      } else tokens.push({ value: ">", quoted: false });
      continue;
    }
    value += char;
  }
  if (quote) return "syntax error: unmatched quote";
  push();
  return tokens;
}

export function parseSegment(tokens: Token[]): Segment | string {
  if (tokens.some((token) => token.value === "&" && !token.quoted)) {
    return "简化版暂不支持：后台任务 &。这里只练习前台文件操作。";
  }
  const first = tokens[0];
  if (!first || ["|", ">", ">>", "2>"].includes(first.value))
    return "syntax error near unexpected token '|'";
  const segment: Segment = { name: first.value, args: [] };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const value = token.value;
    if (!token.quoted && (value === ">" || value === ">>" || value === "2>")) {
      const next = tokens[index + 1];
      if (value === "2>" && next && next.value === ">") {
        return "简化版暂不支持 2>>，请用 2> 与 >> 分别处理。";
      }
      const target = tokens[++index];
      if (
        !target ||
        (!target.quoted && [">", ">>", "2>", "|", "&"].includes(target.value))
      ) {
        return "syntax error near unexpected token newline";
      }
      if (value === "2>") segment.stderrTarget = target.value;
      else
        segment.stdoutTarget = { path: target.value, append: value === ">>" };
    } else segment.args.push(value);
  }
  return segment;
}

export function unsupported(name: string, detail = ""): string {
  return `简化版暂不支持：${name}${detail ? ` ${detail}` : ""}。这里只练习文档中列出的日常文件操作。`;
}

export function withLine(value: string): string {
  return value && !value.endsWith("\n") ? value + "\n" : value;
}

export function shortFlags(
  args: string[],
  allowed: string,
): { flags: Set<string>; rest: string[] } | string {
  const flags = new Set<string>();
  const rest: string[] = [];
  let options = true;
  for (const arg of args) {
    if (options && arg === "--") {
      options = false;
    } else if (options && arg.startsWith("-") && arg !== "-") {
      if (arg.startsWith("--")) return arg;
      for (const flag of arg.slice(1)) {
        if (!allowed.includes(flag)) return `-${flag}`;
        flags.add(flag);
      }
    } else rest.push(arg);
  }
  return { flags, rest };
}

export function displayJoin(parent: string, name: string): string {
  if (parent === "/") return "/" + name;
  return parent.replace(/\/$/, "") + "/" + name;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function longLine(name: string, node: VfsNode): string {
  const links =
    node.type === "directory"
      ? Math.max(
          2,
          Object.values(node.children).filter(
            (child) => child.type === "directory",
          ).length + 2,
        )
      : 1;
  return `${modeString(node)} ${String(links).padStart(2)} ${node.owner} ${node.group} ${String(nodeSize(node)).padStart(5)} ${formatTime(node.mtime)} ${name}`;
}

export class Shell {
  readonly vfs: VirtualFileSystem;

  constructor(vfs = new VirtualFileSystem()) {
    this.vfs = vfs;
  }

  reset(): CommandResult {
    this.vfs.reset();
    return this.result(
      "",
      "",
      0,
      "环境已还原：文件、目录和当前位置都回到了最初状态。",
      "reset",
    );
  }

  execute(input: string): CommandResult {
    const trimmed = input.trim();
    if (!trimmed) return this.result("", "", 0, "", input);
    const tokenized = tokenize(trimmed);
    if (typeof tokenized === "string")
      return this.result(
        "",
        tokenized,
        2,
        "引号要成对出现，shell 才能知道文字在哪里结束。",
        input,
      );
    const rawSegments: Token[][] = [[]];
    for (const token of tokenized) {
      if (token.value === "|" && !token.quoted) rawSegments.push([]);
      else rawSegments[rawSegments.length - 1].push(token);
    }
    if (rawSegments.some((segment) => segment.length === 0)) {
      return this.result(
        "",
        "syntax error near unexpected token '|'",
        2,
        "管道左右两边都要有一条完整命令。",
        input,
      );
    }
    const segments: Segment[] = [];
    for (const raw of rawSegments) {
      const parsed = parseSegment(raw);
      if (typeof parsed === "string")
        return this.result("", parsed, 2, "", input);
      if (!COMMANDS.has(parsed.name))
        return this.result("", unsupported(parsed.name), 1, "", input);
      segments.push(parsed);
    }

    let stdin = "";
    let final: CommandResult = this.result("", "", 0, "", input);
    for (const segment of segments) {
      final = this.runSegment(segment, stdin, input, segments.length > 1);
      stdin = final.stdout;
    }
    return { ...final, executedCommand: input, cwd: this.vfs.cwd };
  }

  private result(
    stdout: string,
    stderr: string,
    exitCode: number,
    explanation: string,
    executedCommand: string,
    pager?: CommandResult["pager"],
  ): CommandResult {
    return {
      stdout,
      stderr,
      exitCode,
      cwd: this.vfs.cwd,
      explanation,
      executedCommand,
      pager,
    };
  }

  private runSegment(
    segment: Segment,
    stdin: string,
    fullCommand: string,
    hasPipe: boolean,
  ): CommandResult {
    const explanation = hasPipe
      ? "管道 | = 把左边的输出交给下一条命令继续处理。"
      : EXPLANATIONS[segment.name] || "";
    let result = this.runBuiltin(
      segment.name,
      segment.args,
      stdin,
      fullCommand,
      explanation,
    );
    try {
      if (segment.stderrTarget && result.stderr) {
        this.vfs.write(segment.stderrTarget, withLine(result.stderr), false);
        result = { ...result, stderr: "" };
      } else if (segment.stderrTarget) {
        this.vfs.write(segment.stderrTarget, "", false);
      }
      if (
        segment.stdoutTarget &&
        !result.pager &&
        !result.stderr.startsWith("简化版暂不支持：cat")
      ) {
        this.vfs.write(
          segment.stdoutTarget.path,
          withLine(result.stdout),
          segment.stdoutTarget.append,
        );
        result = { ...result, stdout: "" };
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw.replace(
        /^write:/,
        segment.stdoutTarget ? segment.name : segment.name,
      );
      result = {
        ...result,
        stderr: message,
        stdout: "",
        exitCode: 1,
        pager: undefined,
      };
    }
    return result;
  }

  private runBuiltin(
    name: string,
    args: string[],
    stdin: string,
    fullCommand: string,
    explanation: string,
  ): CommandResult {
    const done = (
      stdout = "",
      stderr = "",
      exitCode = 0,
      pager?: CommandResult["pager"],
    ) => this.result(stdout, stderr, exitCode, explanation, fullCommand, pager);
    try {
      switch (name) {
        case "pwd": {
          if (args.length) return done("", unsupported(name, args[0]), 1);
          return done(this.vfs.cwd);
        }
        case "echo":
          return done(args.join(" "));
        case "cd": {
          if (args.length > 1) return done("", "cd: too many arguments", 1);
          const target = args[0] || HOME;
          const node = this.vfs.getNode(target);
          if (!node)
            return done("", `cd: ${target}: No such file or directory`, 1);
          if (node.type !== "directory")
            return done("", `cd: ${target}: Not a directory`, 1);
          this.vfs.cwd = this.vfs.resolve(target);
          return done();
        }
        case "cat": {
          if (!args.length)
            return done(
              "",
              unsupported(
                "cat",
                "无参数或交互式写入；请使用 echo 文字 > 文件名",
              ),
              1,
            );
          const outputs: string[] = [];
          for (const path of args) {
            const node = this.vfs.getNode(path);
            if (!node)
              return done("", `cat: ${path}: No such file or directory`, 1);
            if (node.type === "directory")
              return done("", `cat: ${path}: Is a directory`, 1);
            if (!isReadable(node))
              return done("", `cat: ${path}: Permission denied`, 1);
            outputs.push(node.content);
          }
          return done(outputs.join(""));
        }
        case "mkdir": {
          const parsed = shortFlags(args, "p");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (!parsed.rest.length) return done("", "mkdir: missing operand", 1);
          parsed.rest.forEach((path) =>
            this.vfs.mkdir(path, parsed.flags.has("p")),
          );
          return done();
        }
        case "touch": {
          const parsed = shortFlags(args, "");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (!parsed.rest.length)
            return done("", "touch: missing file operand", 1);
          parsed.rest.forEach((path) => this.vfs.touch(path));
          return done();
        }
        case "cp": {
          const parsed = shortFlags(args, "r");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (parsed.rest.length !== 2)
            return done("", "cp: 需要源路径和目标路径", 1);
          this.vfs.copy(parsed.rest[0], parsed.rest[1], parsed.flags.has("r"));
          return done();
        }
        case "mv": {
          const parsed = shortFlags(args, "");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (parsed.rest.length !== 2)
            return done("", "mv: 需要源路径和目标路径", 1);
          this.vfs.move(parsed.rest[0], parsed.rest[1]);
          return done();
        }
        case "rm": {
          const parsed = shortFlags(args, "rf");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (!parsed.rest.length) {
            if (parsed.flags.has("f")) return done();
            return done("", "rm: missing operand", 1);
          }
          parsed.rest.forEach((path) =>
            this.vfs.remove(path, parsed.flags.has("r"), parsed.flags.has("f")),
          );
          return done();
        }
        case "chmod": {
          const parsed = shortFlags(args, "");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (parsed.rest.length !== 2)
            return done("", "chmod: 需要权限模式和文件路径", 1);
          const [mode, path] = parsed.rest;
          const node = this.vfs.getNode(path);
          if (!node)
            return done(
              "",
              `chmod: cannot access '${path}': No such file or directory`,
              1,
            );
          if (/^[0-7]{3}$/.test(mode)) node.mode = Number.parseInt(mode, 8);
          else {
            const operations = mode.split(",");
            if (
              !operations.every((operation) =>
                /^[ugo]+[+-][rwx]+$/.test(operation),
              )
            ) {
              return done("", `chmod: invalid mode: '${mode}'`, 1);
            }
            for (const operation of operations) {
              const match = operation.match(/^([ugo]+)([+-])([rwx]+)$/)!;
              let mask = 0;
              for (const who of match[1]) {
                for (const permission of match[3]) {
                  const whoShift = who === "u" ? 6 : who === "g" ? 3 : 0;
                  const permissionBit =
                    permission === "r" ? 4 : permission === "w" ? 2 : 1;
                  mask |= permissionBit << whoShift;
                }
              }
              node.mode =
                match[2] === "+" ? node.mode | mask : node.mode & ~mask;
            }
          }
          node.mtime = Date.now();
          return done();
        }
        case "ls":
          return this.ls(args, fullCommand, explanation);
        case "grep":
          return this.grep(args, stdin, fullCommand, explanation);
        case "find":
          return this.find(args, fullCommand, explanation);
        case "which":
        case "whereis": {
          if (!args.length) return done("", `${name}: missing command name`, 1);
          const found = args
            .map((command) => COMMAND_PATHS[command])
            .filter(Boolean);
          return done(
            found.join("\n"),
            "",
            found.length === args.length ? 0 : 1,
          );
        }
        case "less": {
          if (args.length > 1)
            return done("", unsupported(name, "选项或多个文件"), 1);
          let content = stdin;
          let title = "标准输入";
          if (args.length) {
            const node = this.vfs.getNode(args[0]);
            if (!node)
              return done("", `less: ${args[0]}: No such file or directory`, 1);
            if (node.type === "directory")
              return done("", `less: ${args[0]}: Is a directory`, 1);
            if (!isReadable(node))
              return done("", `less: ${args[0]}: Permission denied`, 1);
            content = node.content;
            title = args[0];
          }
          if (!args.length && !stdin)
            return done(
              "",
              unsupported("less", "无输入；请传入文件或使用管道"),
              1,
            );
          return done("", "", 0, { title, content });
        }
        default:
          return done("", unsupported(name), 1);
      }
    } catch (error) {
      return done(
        "",
        error instanceof Error ? error.message : String(error),
        1,
      );
    }
  }

  private ls(
    args: string[],
    fullCommand: string,
    explanation: string,
  ): CommandResult {
    const parsed = shortFlags(args, "laR");
    if (typeof parsed === "string")
      return this.result(
        "",
        unsupported("ls", parsed),
        1,
        explanation,
        fullCommand,
      );
    if (parsed.rest.length > 1)
      return this.result(
        "",
        unsupported("ls", "同时列出多个路径"),
        1,
        explanation,
        fullCommand,
      );
    const inputPath = parsed.rest[0] || ".";
    const node = this.vfs.getNode(inputPath);
    if (!node)
      return this.result(
        "",
        `ls: cannot access '${inputPath}': No such file or directory`,
        2,
        explanation,
        fullCommand,
      );
    const all = parsed.flags.has("a");
    const long = parsed.flags.has("l");
    const renderEntries = (
      dir: DirectoryNode,
      absolutePath: string,
    ): string[] => {
      const entries: Array<[string, VfsNode]> = Object.entries(dir.children)
        .filter(([childName]) => all || !childName.startsWith("."))
        .sort(([a], [b]) => a.localeCompare(b, "zh-CN"));
      if (all) {
        const parent = this.vfs.getNode("..", absolutePath) || dir;
        entries.unshift(["..", parent]);
        entries.unshift([".", dir]);
      }
      if (long) {
        const lines = [`total ${entries.length}`];
        entries.forEach(([childName, child]) =>
          lines.push(longLine(childName, child)),
        );
        return lines;
      }
      return entries.map(([childName]) => childName);
    };
    if (node.type === "file") {
      return this.result(
        long ? longLine(inputPath, node) : inputPath,
        "",
        0,
        explanation,
        fullCommand,
      );
    }
    const absolute = this.vfs.resolve(inputPath);
    const lines: string[] = [];
    const visit = (
      dir: DirectoryNode,
      path: string,
      label: string,
      top: boolean,
    ) => {
      if (parsed.flags.has("R")) {
        if (!top) lines.push("");
        lines.push(`${label}:`);
      }
      lines.push(...renderEntries(dir, path));
      if (parsed.flags.has("R")) {
        Object.entries(dir.children)
          .filter(
            ([childName, child]) =>
              child.type === "directory" && (all || !childName.startsWith(".")),
          )
          .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
          .forEach(([childName, child]) =>
            visit(
              child as DirectoryNode,
              this.vfs.resolve(childName, path),
              displayJoin(label, childName),
              false,
            ),
          );
      }
    };
    visit(node, absolute, inputPath, true);
    return this.result(lines.join("\n"), "", 0, explanation, fullCommand);
  }

  private grep(
    args: string[],
    stdin: string,
    fullCommand: string,
    explanation: string,
  ): CommandResult {
    const parsed = shortFlags(args, "nc");
    if (typeof parsed === "string")
      return this.result(
        "",
        unsupported("grep", parsed),
        1,
        explanation,
        fullCommand,
      );
    if (parsed.rest.length < 1 || parsed.rest.length > 2) {
      return this.result(
        "",
        "grep: 用法：grep [-n|-c] 要找的 [从哪找]",
        2,
        explanation,
        fullCommand,
      );
    }
    const [pattern, path] = parsed.rest;
    let content = stdin;
    if (path) {
      const node = this.vfs.getNode(path);
      if (!node)
        return this.result(
          "",
          `grep: ${path}: No such file or directory`,
          2,
          explanation,
          fullCommand,
        );
      if (node.type === "directory")
        return this.result(
          "",
          `grep: ${path}: Is a directory`,
          2,
          explanation,
          fullCommand,
        );
      if (!isReadable(node))
        return this.result(
          "",
          `grep: ${path}: Permission denied`,
          2,
          explanation,
          fullCommand,
        );
      content = node.content;
    } else if (!stdin)
      return this.result(
        "",
        unsupported("grep", "无输入；请提供文件或使用管道"),
        1,
        explanation,
        fullCommand,
      );
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const matches = lines
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.includes(pattern));
    if (parsed.flags.has("c"))
      return this.result(
        String(matches.length),
        "",
        matches.length ? 0 : 1,
        explanation,
        fullCommand,
      );
    const output = matches
      .map(({ line, number }) =>
        parsed.flags.has("n") ? `${number}:${line}` : line,
      )
      .join("\n");
    return this.result(
      output,
      "",
      matches.length ? 0 : 1,
      explanation,
      fullCommand,
    );
  }

  private find(
    args: string[],
    fullCommand: string,
    explanation: string,
  ): CommandResult {
    if (args.length !== 3 || args[1] !== "-name") {
      return this.result(
        "",
        unsupported("find", '仅支持 find 路径 -name "通配符"'),
        1,
        explanation,
        fullCommand,
      );
    }
    const [start, , pattern] = args;
    const startNode = this.vfs.getNode(start);
    if (!startNode)
      return this.result(
        "",
        `find: ‘${start}’: No such file or directory`,
        1,
        explanation,
        fullCommand,
      );
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
    );
    const matches: string[] = [];
    const visit = (name: string, label: string, node: VfsNode) => {
      if (regex.test(name)) matches.push(label);
      if (node.type === "directory") {
        Object.entries(node.children)
          .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
          .forEach(([childName, child]) =>
            visit(childName, displayJoin(label, childName), child),
          );
      }
    };
    const startName =
      start === "/" ? "/" : start.replace(/\/$/, "").split("/").pop() || start;
    visit(startName, start.replace(/\/$/, "") || "/", startNode);
    return this.result(matches.join("\n"), "", 0, explanation, fullCommand);
  }
}

export function quotePath(path: string): string {
  if (/^[\w./\-\u4e00-\u9fff]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
