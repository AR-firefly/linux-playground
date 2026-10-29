/** 输入即解释：在回车之前算出这条命令会做什么、动到谁、有多大风险。 */
import { tokenize, parseSegment, type Segment } from "./shell";

export interface PreviewTarget {
  path: string;
  exists: boolean;
  kind?: "file" | "directory";
  files?: number;
  bytes?: number;
}

export interface PreviewContext {
  cwd: string;
  home: string;
  resolve: (path: string) => string;
  probe: (path: string) => Promise<PreviewTarget>;
}

export type PreviewRisk = "none" | "warn" | "danger";

export interface Preview {
  command: string | null;
  title: string;
  flags: { flag: string; text: string }[];
  detail?: string;
  risk: PreviewRisk;
  warning?: string;
  note?: string;
}

const TITLES: Record<string, string> = {
  pwd: "显示当前所在目录",
  ls: "列出目录里的内容",
  cd: "切换当前目录",
  cat: "把文件内容打印出来",
  mkdir: "新建目录",
  touch: "新建空文件 / 更新时间戳",
  cp: "复制文件或目录",
  mv: "移动或改名",
  rm: "删除文件或目录",
  less: "分页查看文件",
  chmod: "修改权限（模拟环境仅演示）",
  echo: "输出一段文字，可写入文件",
  grep: "在文件里按内容筛选行",
  find: "按文件名通配符查找",
  which: "查命令位置",
  whereis: "查命令相关文件",
};

const FLAGS: Record<string, Record<string, string>> = {
  ls: {
    l: "长格式：权限、属主、大小、时间",
    a: "显示以 . 开头的隐藏文件",
    R: "递归列出子目录",
    "1": "每行一个",
  },
  mkdir: { p: "缺少的上级目录一并创建" },
  cp: { r: "递归复制目录", R: "递归复制目录" },
  rm: {
    r: "递归：连同目录内容一起删",
    R: "递归：连同目录内容一起删",
    f: "强制：不询问、缺文件也不报错",
  },
  grep: { n: "显示行号", c: "只输出匹配行数" },
};

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const describeTarget = (target: PreviewTarget): string => {
  if (!target.exists) return `${target.path}（不存在）`;
  if (target.kind === "directory") {
    return `${target.path}（目录，${target.files ?? 0} 个文件，${fmtSize(target.bytes ?? 0)}）`;
  }
  return `${target.path}（文件，${fmtSize(target.bytes ?? 0)}）`;
};

function collectFlags(segment: Segment): {
  flags: { flag: string; text: string }[];
} {
  const dict = FLAGS[segment.name] || {};
  const flags: { flag: string; text: string }[] = [];
  for (const arg of segment.args) {
    if (!arg.startsWith("-") || arg === "-") continue;
    for (const char of arg.replace(/^-+/, "")) {
      const text = dict[char];
      if (text) flags.push({ flag: `-${char}`, text });
    }
  }
  return { flags };
}

export async function buildPreview(
  input: string,
  ctx: PreviewContext,
): Promise<Preview | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (typeof tokens === "string") {
    return {
      command: null,
      title: "引号还没有闭合",
      flags: [],
      risk: "none",
      note: "补上另一半引号才能执行。",
    };
  }
  const rawSegments: (typeof tokens)[] = [[]];
  for (const token of tokens) {
    if (token.value === "|" && !token.quoted) rawSegments.push([]);
    else rawSegments[rawSegments.length - 1].push(token);
  }
  const first = parseSegment(rawSegments[0]);
  if (typeof first === "string") {
    return { command: null, title: first, flags: [], risk: "none" };
  }
  const title = TITLES[first.name];
  if (!title) {
    return {
      command: first.name,
      title: `简化版没有 ${first.name}`,
      flags: [],
      risk: "none",
      note: "回车后会提示不支持；这里只覆盖日常文件操作。",
    };
  }
  const { flags } = collectFlags(first);
  const preview: Preview = { command: first.name, title, flags, risk: "none" };
  const rest = first.args.filter((arg) => !arg.startsWith("-"));
  const pipe = rawSegments.length > 1 ? "（管道：结果交给下一条命令）" : "";

  const target = async (path: string) => ctx.probe(ctx.resolve(path));

  switch (first.name) {
    case "cd": {
      const path = rest[0] || "~";
      const info = await target(path);
      preview.detail = info.exists
        ? `进入 ${info.path}`
        : `${info.path} 不存在，回车会报错`;
      preview.risk = info.exists ? "none" : "warn";
      break;
    }
    case "ls": {
      const path = rest[0] || ".";
      const info = await target(path);
      preview.detail = info.exists
        ? describeTarget(info)
        : `${info.path} 不存在`;
      preview.risk = info.exists ? "none" : "warn";
      break;
    }
    case "cat":
    case "less": {
      if (!rest.length) {
        preview.detail = "需要指定文件";
        preview.risk = "warn";
        break;
      }
      const info = await target(rest[0]);
      preview.detail = describeTarget(info);
      preview.risk = info.exists && info.kind === "file" ? "none" : "warn";
      break;
    }
    case "mkdir": {
      const path = rest[0];
      if (!path) {
        preview.detail = "需要指定目录名";
        preview.risk = "warn";
        break;
      }
      const info = await target(path);
      preview.detail = info.exists
        ? `${info.path} 已存在，回车会报错`
        : `创建目录 ${info.path}`;
      preview.risk = info.exists ? "warn" : "none";
      break;
    }
    case "touch": {
      const path = rest[0];
      if (!path) {
        preview.detail = "需要指定文件名";
        preview.risk = "warn";
        break;
      }
      const info = await target(path);
      preview.detail = info.exists
        ? `更新 ${info.path} 的时间戳`
        : `创建空文件 ${info.path}`;
      break;
    }
    case "rm": {
      if (!rest.length) {
        preview.detail = "需要指定要删除的目标";
        preview.risk = "warn";
        break;
      }
      const infos = await Promise.all(rest.map(target));
      preview.detail = infos.map(describeTarget).join("\n");
      const recursive = first.args.some((arg) => /^-[a-zA-Z]*[rR]/.test(arg));
      const dirs = infos.filter((info) => info.kind === "directory").length;
      const home = ctx.home.replace(/\/+$/, "") || "/";
      const hitsHome = infos.some((info) => info.path === home);
      const hitsRoot = infos.some((info) => info.path === "/");
      if (hitsHome || hitsRoot) {
        preview.risk = "danger";
        preview.warning = hitsRoot
          ? "目标包含根目录：真机上等于毁掉整个系统。"
          : "目标包含你的家目录：真机上等于删掉全部个人文件。";
      } else if (recursive || dirs) {
        preview.risk = "danger";
        preview.warning =
          "递归删除：目录连同里面所有内容一起消失。模拟环境可以重置，真机不可恢复。";
      } else {
        preview.risk = "warn";
        preview.warning = "删除后模拟环境可以重置，真机不可恢复。";
      }
      break;
    }
    case "mv": {
      if (rest.length < 2) {
        preview.detail = "需要源和目标";
        preview.risk = "warn";
        break;
      }
      const source = await target(rest[0]);
      const dest = await target(rest[rest.length - 1]);
      preview.detail = `${describeTarget(source)} → ${dest.path}`;
      if (dest.exists && dest.kind === "file") {
        preview.risk = "warn";
        preview.warning = "目标已存在，会被覆盖。";
      }
      break;
    }
    case "cp": {
      if (rest.length < 2) {
        preview.detail = "需要源和目标";
        preview.risk = "warn";
        break;
      }
      const source = await target(rest[0]);
      const dest = await target(rest[rest.length - 1]);
      preview.detail = `${describeTarget(source)} → ${dest.path}`;
      if (dest.exists && dest.kind === "file") {
        preview.risk = "warn";
        preview.warning = "目标已存在，会被覆盖。";
      }
      break;
    }
    case "grep": {
      preview.detail = rest.length
        ? `在 ${rest.slice(1).join("、") || "管道输入"} 里找「${rest[0]}」`
        : "需要指定要找的内容";
      preview.risk = rest.length ? "none" : "warn";
      break;
    }
    case "find": {
      preview.detail = rest.length
        ? `在 ${rest[0]} 下按 ${rest[2] || "*"} 查找`
        : "需要指定起点目录";
      preview.risk = rest.length ? "none" : "warn";
      break;
    }
    case "chmod":
    case "which":
    case "whereis":
      preview.note = "这条命令只在完整 Linux 模式里真实生效。";
      break;
    default:
      break;
  }

  if (first.stdoutTarget) {
    const info = await target(first.stdoutTarget.path);
    const mode = first.stdoutTarget.append ? "追加到" : "写入";
    preview.detail = `${preview.detail ? preview.detail + "\n" : ""}${mode} ${info.path}${info.exists ? "（已存在，会被覆盖）" : "（新建）"}`;
    if (!first.stdoutTarget.append && info.exists) preview.risk = "warn";
  }
  if (pipe) preview.note = pipe;
  return preview;
}
