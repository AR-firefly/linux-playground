import {
  COMMANDS,
  EXPLANATIONS,
  formatTime,
  parseSegment,
  shortFlags,
  tokenize,
  unsupported,
  withLine,
  type Segment,
  type Token,
} from "../engine/shell";
import type { CommandResult } from "../engine/types";
import {
  FsError,
  joinPath,
  resolveVirtual,
  type AsyncFs,
} from "./types";

const FOLDER_UNSUPPORTED = (name: string) =>
  `此模式暂不支持：${name}。它只覆盖日常文件操作；需要完整 Linux 能力请用「完整 Linux」模式。`;

const PERMISSION_NOTE = "（浏览器拿不到真实权限位，-l 显示的权限是常见默认值）";
const PERMISSION_LINE = "（提示：权限列为常见默认值，浏览器无法读取真实权限位）";
const MAX_WALK_DEPTH = 20;
const MAX_WALK_ENTRIES = 2000;

function assertNotTrash(path: string): void {
  if (path === "/.trash" || path.startsWith("/.trash/")) {
    throw new FsError("回收站目录由系统管理，请使用「清空回收站」");
  }
}

/** 在真实文件夹（或导入副本）上执行的异步命令引擎。 */
export class FsShell {
  readonly fs: AsyncFs;
  cwd = "/";
  private hintsAllowed = true;

  constructor(fs: AsyncFs) {
    this.fs = fs;
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
      cwd: this.cwd,
      explanation,
      executedCommand,
      pager,
    };
  }

  async execute(input: string): Promise<CommandResult> {
    const trimmed = input.trim();
    if (!trimmed) return this.result("", "", 0, "", input);
    const tokenized = tokenize(trimmed);
    if (typeof tokenized === "string") {
      return this.result("", tokenized, 2, "引号要成对出现。", input);
    }
    const raw: Token[][] = [[]];
    for (const token of tokenized) {
      if (token.value === "|" && !token.quoted) raw.push([]);
      else raw[raw.length - 1].push(token);
    }
    if (raw.some((segment) => segment.length === 0)) {
      return this.result(
        "",
        "syntax error near unexpected token '|'",
        2,
        "管道左右都要有完整命令。",
        input,
      );
    }
    const segments: Segment[] = [];
    for (const tokens of raw) {
      const parsed = parseSegment(tokens);
      if (typeof parsed === "string")
        return this.result("", parsed, 2, "", input);
      if (!COMMANDS.has(parsed.name)) {
        return this.result("", FOLDER_UNSUPPORTED(parsed.name), 1, "", input);
      }
      segments.push(parsed);
    }

    let stdin = "";
    let final: CommandResult = this.result("", "", 0, "", input);
    for (const segment of segments) {
      final = await this.runSegment(segment, stdin, input, segments.length > 1);
      stdin = final.stdout;
    }
    return { ...final, executedCommand: input, cwd: this.cwd };
  }

  private async runSegment(
    segment: Segment,
    stdin: string,
    full: string,
    hasPipe: boolean,
  ): Promise<CommandResult> {
    const explanation = hasPipe
      ? "管道 | = 把左边的输出交给下一条命令继续处理。"
      : EXPLANATIONS[segment.name] || "";
    this.hintsAllowed = !segment.stdoutTarget && !hasPipe;
    let result = await this.runBuiltin(
      segment.name,
      segment.args,
      stdin,
      full,
      explanation,
    );
    try {
      if (segment.stderrTarget) {
        const target = resolveVirtual(segment.stderrTarget, this.cwd);
        assertNotTrash(target);
        await this.fs.write(target, result.stderr ? withLine(result.stderr) : "", false);
        result = { ...result, stderr: "" };
      }
      if (segment.stdoutTarget && !result.pager) {
        const target = resolveVirtual(segment.stdoutTarget.path, this.cwd);
        assertNotTrash(target);
        await this.fs.write(
          target,
          withLine(result.stdout),
          segment.stdoutTarget.append,
        );
        result = { ...result, stdout: "" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        ...result,
        stdout: "",
        stderr: message,
        exitCode: 1,
        pager: undefined,
      };
    }
    return result;
  }

  private async runBuiltin(
    name: string,
    args: string[],
    stdin: string,
    full: string,
    explanation: string,
  ): Promise<CommandResult> {
    const done = (
      stdout = "",
      stderr = "",
      exitCode = 0,
      pager?: CommandResult["pager"],
    ) => this.result(stdout, stderr, exitCode, explanation, full, pager);
    try {
      switch (name) {
        case "pwd":
          return args.length
            ? done("", unsupported(name, args[0]), 1)
            : done(this.cwd);

        case "echo":
          return done(args.join(" "));

        case "cd": {
          if (args.length > 1)
            return done("", "bash: cd: too many arguments", 1);
          const target = resolveVirtual(args[0] || "/", this.cwd);
          const stat = await this.fs.stat(target);
          if (!stat)
            return done(
              "",
              `cd: ${args[0] || target}: No such file or directory`,
              1,
            );
          if (stat.kind !== "directory")
            return done(
              "",
              `cd: ${args[0] || target}: Not a directory`,
              1,
            );
          this.cwd = target;
          return done("");
        }

        case "ls": {
          const parsed = shortFlags(args, "laR1");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          const long = parsed.flags.has("l");
          const showAll = parsed.flags.has("a");
          const recursive = parsed.flags.has("R");
          const targets = parsed.rest.length ? parsed.rest : ["."];
          const blocks: string[] = [];
          for (const target of targets) {
            const absolute = resolveVirtual(target, this.cwd);
            const stat = await this.fs.stat(absolute);
            if (!stat)
              return done(
                "",
                `ls: cannot access '${target}': No such file or directory`,
                2,
              );
            if (targets.length > 1) blocks.push(`${target}:`);
            if (stat.kind === "file") {
              blocks.push(long ? this.longLine(target, stat) : target);
              continue;
            }
            const rows = await this.listDir(
              absolute,
              long,
              showAll,
              recursive,
              target === "." ? "" : target,
            );
            if (showAll) rows.unshift("..", ".");
            for (const row of rows) blocks.push(row);
          }
          if (long && this.hintsAllowed) blocks.push(PERMISSION_LINE);
          return {
            ...done(blocks.join("\n"), "", 0),
            explanation: long ? explanation + PERMISSION_NOTE : explanation,
          };
        }

        case "cat": {
          if (!args.length) {
            // 管道里 cat 读取左侧输出；单独执行则给友好提示
            if (stdin) return done(stdin);
            return done("", "cat: 请指定要读取的文件，例如 cat readme.txt", 1);
          }
          const chunks: string[] = [];
          for (const path of args) {
            const absolute = resolveVirtual(path, this.cwd);
            const stat = await this.fs.stat(absolute);
            if (!stat)
              return done("", `cat: ${path}: No such file or directory`, 1);
            if (stat.kind !== "file")
              return done("", `cat: ${path}: Is a directory`, 1);
            chunks.push(await this.fs.read(absolute));
          }
          return done(chunks.join(""));
        }

        case "mkdir": {
          const parsed = shortFlags(args, "p");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (!parsed.rest.length) return done("", "mkdir: missing operand", 1);
          for (const path of parsed.rest) {
            try {
              const absolute = resolveVirtual(path, this.cwd);
              assertNotTrash(absolute);
              await this.fs.mkdir(absolute, parsed.flags.has("p"));
            } catch (error) {
              const message =
                error instanceof FsError ? error.message : String(error);
              return done(
                "",
                `mkdir: cannot create directory '${path}': ${message}`,
                1,
              );
            }
          }
          return done("");
        }

        case "touch": {
          if (!args.length) return done("", "touch: missing file operand", 1);
          for (const path of args) {
            try {
              const absolute = resolveVirtual(path, this.cwd);
              assertNotTrash(absolute);
              await this.fs.touch(absolute);
            } catch (error) {
              const message =
                error instanceof FsError ? error.message : String(error);
              return done("", `touch: cannot touch '${path}': ${message}`, 1);
            }
          }
          return done("");
        }

        case "cp": {
          const parsed = shortFlags(args, "rR");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (parsed.rest.length < 2)
            return done("", "cp: missing file operand", 1);
          const target = resolveVirtual(parsed.rest.pop()!, this.cwd);
          for (const source of parsed.rest) {
            try {
              assertNotTrash(target);
              await this.fs.copy(
                resolveVirtual(source, this.cwd),
                target,
                parsed.flags.has("r") || parsed.flags.has("R"),
              );
            } catch (error) {
              const message =
                error instanceof FsError ? error.message : String(error);
              return done("", `cp: ${message}`, 1);
            }
          }
          return done("");
        }

        case "mv": {
          const mvParsed = shortFlags(args, "");
          if (typeof mvParsed === "string")
            return done("", unsupported(name, mvParsed), 1);
          const mvArgs = mvParsed.rest;
          if (mvArgs.length < 2) return done("", "mv: missing file operand", 1);
          const target = resolveVirtual(mvArgs.pop()!, this.cwd);
          for (const source of mvArgs) {
            try {
              assertNotTrash(target);
              await this.fs.move(resolveVirtual(source, this.cwd), target);
            } catch (error) {
              const message =
                error instanceof FsError ? error.message : String(error);
              return done("", `mv: ${message}`, 1);
            }
          }
          return done("");
        }

        case "rm": {
          const parsed = shortFlags(args, "rRf");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (!parsed.rest.length) {
            return parsed.flags.has("f")
              ? done("")
              : done("", "rm: missing operand", 1);
          }
          for (const path of parsed.rest) {
            try {
              await this.fs.remove(
                resolveVirtual(path, this.cwd),
                parsed.flags.has("r") || parsed.flags.has("R"),
                parsed.flags.has("f"),
              );
            } catch (error) {
              const message =
                error instanceof FsError ? error.message : String(error);
              return done("", `rm: cannot remove '${path}': ${message}`, 1);
            }
          }
          return done("", "", 0, undefined);
        }

        case "less": {
          if (!args.length) return done("", "less: 请指定要查看的文件", 1);
          if (args.length > 1)
            return done("", "less: 暂不支持同时查看多个文件", 1);
          const path = args[0];
          const absolute = resolveVirtual(path, this.cwd);
          const stat = await this.fs.stat(absolute);
          if (!stat)
            return done("", `less: ${path}: No such file or directory`, 1);
          if (stat.kind !== "file")
            return done("", `less: ${path}: Is a directory`, 1);
          const content = await this.fs.read(absolute);
          return done("", "", 0, { title: path, content });
        }

        case "grep": {
          const parsed = shortFlags(args, "nc");
          if (typeof parsed === "string")
            return done("", unsupported(name, parsed), 1);
          if (!parsed.rest.length)
            return done("", "Usage: grep 要找的内容 文件…", 1);
          const [pattern, ...files] = parsed.rest;
          const lines: string[] = [];
          let total = 0;
          const collect = (content: string, label?: string) => {
            const hits = content
              .split("\n")
              .map((line, index) => ({ line, number: index + 1 }))
              .filter((row) => row.line.includes(pattern));
            total += hits.length;
            for (const hit of hits) {
              const prefix =
                (parsed.flags.has("n") ? `${hit.number}:` : "") +
                (label && files.length > 1 ? `${label}:` : "");
              lines.push(prefix + hit.line);
            }
          };
          if (!files.length) {
            // 没有文件参数时读管道输入（grep 的标准行为）
            if (!stdin) return done("", "grep: 请指定要搜索的文件", 1);
            collect(stdin);
          } else {
            for (const file of files) {
              const absolute = resolveVirtual(file, this.cwd);
              const stat = await this.fs.stat(absolute);
              if (!stat)
                return done("", `grep: ${file}: No such file or directory`, 1);
              if (stat.kind !== "file")
                return done("", `grep: ${file}: Is a directory`, 1);
              collect(await this.fs.read(absolute), file);
            }
          }
          if (parsed.flags.has("c"))
            return done(String(total), "", total ? 0 : 1);
          return total ? done(lines.join("\n")) : done("", "", 1);
        }

        case "find": {
          if (!args.length) return done("", "find: 缺少路径", 1);
          const start = args[0];
          if (args.length !== 3 || args[1] !== "-name") {
            return done(
              "",
              FOLDER_UNSUPPORTED(
                'find 的该用法（仅支持 find 路径 -name "通配符"）',
              ),
              1,
            );
          }
          const wildcard = args[2];
          const regex = new RegExp(
            "^" +
              wildcard
                .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".") +
              "$",
          );
          const results: string[] = [];
          let visited = 0;
          const walk = async (
            absolute: string,
            display: string,
            depth: number,
          ) => {
            if (depth >= MAX_WALK_DEPTH || visited >= MAX_WALK_ENTRIES) return;
            const entries = await this.fs.list(absolute);
            for (const entry of entries) {
              if (visited++ >= MAX_WALK_ENTRIES) return;
              const childAbsolute = joinPath(absolute, entry.name);
              const childDisplay =
                display === "."
                  ? `./${entry.name}`
                  : `${display}/${entry.name}`;
              if (regex.test(entry.name)) results.push(childDisplay);
              if (entry.kind === "directory")
                await walk(childAbsolute, childDisplay, depth + 1);
            }
          };
          const absoluteStart = resolveVirtual(start, this.cwd);
          const stat = await this.fs.stat(absoluteStart);
          if (!stat)
            return done("", `find: '${start}': No such file or directory`, 1);
          await walk(absoluteStart, start, 0);
          if (visited >= MAX_WALK_ENTRIES) {
            results.push("（结果过多，仅显示前 2000 项）");
          }
          return done(results.join("\n"), "", 0);
        }

        case "chmod":
          return done(
            "",
            "chmod：浏览器拿不到权限位，此模式无法修改权限；请用「完整 Linux」模式。",
            1,
          );

        case "which":
        case "whereis":
          return done(
            "",
            `${name}：此模式没有系统命令路径（你操作的是一个文件夹，不是整个系统）；请用「完整 Linux」模式。`,
            1,
          );

        default:
          return done("", FOLDER_UNSUPPORTED(name), 1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return done("", `${name}: ${message}`, 1);
    }
  }

  private longLine(
    name: string,
    stat: { kind: string; size: number; mtime: number },
  ): string {
    const mode = stat.kind === "directory" ? "drwxr-xr-x" : "-rw-r--r--";
    return `${mode} 1 you you ${String(stat.size).padStart(6)} ${stat.mtime ? formatTime(stat.mtime) : "Jan 01 00:00"} ${name}`;
  }

  private async listDir(
    absolute: string,
    long: boolean,
    showAll: boolean,
    recursive: boolean,
    display: string,
    depth = 0,
    state: { count: number; truncated: boolean; hinted: boolean } = {
      count: 0,
      truncated: false,
      hinted: false,
    },
  ): Promise<string[]> {
    const rows: string[] = [];
    if (state.count >= MAX_WALK_ENTRIES) {
      if (!state.hinted) {
        state.hinted = true;
        rows.push("（条目过多，仅显示前 2000 项）");
      }
      return rows;
    }

    const all = (await this.fs.list(absolute)).filter(
      (entry) => showAll || !entry.name.startsWith("."),
    );
    const quota = MAX_WALK_ENTRIES - state.count;
    const entries = all.slice(0, quota);
    state.count += entries.length;
    if (all.length > entries.length) state.truncated = true;

    for (const entry of entries) {
      rows.push(
        long
          ? this.longLine(entry.name + (entry.kind === "directory" ? "/" : ""), {
              kind: entry.kind,
              size: entry.size,
              mtime: entry.mtime,
            })
          : entry.name + (entry.kind === "directory" ? "/" : ""),
      );
    }

    if (!recursive) {
      if (state.truncated && !state.hinted) {
        state.hinted = true;
        rows.push("（条目过多，仅显示前 2000 项）");
      }
      return rows;
    }

    if (depth >= MAX_WALK_DEPTH) {
      if (entries.some((entry) => entry.kind === "directory")) {
        rows.push("", "（目录层级过深，已停止继续展开）");
      }
      return rows;
    }

    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      if (state.count >= MAX_WALK_ENTRIES) {
        state.truncated = true; // 还有未展开目录，必须提示
        break;
      }
      const childAbsolute = joinPath(absolute, entry.name);
      const childDisplay = display ? `${display}/${entry.name}` : entry.name;
      rows.push("", `${childDisplay}:`);
      const childRows = await this.listDir(
        childAbsolute,
        long,
        showAll,
        true,
        childDisplay,
        depth + 1,
        state,
      );
      for (const row of childRows) rows.push(row);
    }

    if (state.truncated && !state.hinted) {
      state.hinted = true;
      rows.push("", "（条目过多，仅显示前 2000 项）");
    }
    return rows;
  }
}

export { FOLDER_UNSUPPORTED };
