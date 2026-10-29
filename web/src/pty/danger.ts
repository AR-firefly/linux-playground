/** 危险命令识别（尽力而为：只对能看清的输入行生效，用于二次确认）。 */

interface Rule {
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  { pattern: /\bdd\b.*\bof=\/dev\//, reason: "直接写入块设备（dd）" },
  { pattern: /\bmkfs(\.\w+)?\b/, reason: "格式化文件系统（mkfs）" },
  { pattern: /\bshred\b/, reason: "不可恢复地粉碎文件（shred）" },
  { pattern: /\bchmod\s+-R\s+777\s+\//, reason: "递归开放根目录权限" },
  {
    pattern: /\b(?:curl|wget)\b.*\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
    reason: "下载脚本并直接执行",
  },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: "覆盖磁盘设备" },
  { pattern: /\bmv\s+\S+\s+\/dev\/null\b/, reason: "把文件移入 /dev/null" },
  { pattern: /:\s*\(\s*\)\s*\{[^}]*\}\s*;?\s*:/, reason: "fork 炸弹" },
];

export function dangerousReason(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const rm = /\brm\b([^\n]*)$/.exec(trimmed);
  if (rm) {
    const rest = rm[1];
    const recursive =
      /(^|\s)-[a-zA-Z]*[rR][a-zA-Z]*(\s|$)/.test(rest) ||
      /--recursive\b/.test(rest);
    const force =
      /(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)/.test(rest) || /--force\b/.test(rest);
    if (/(^|\s)(~|\$HOME)(\s|$)/.test(rest)) return "删除家目录";
    if (/(^|\s)\/(\s|$)/.test(rest)) return "删除根目录";
    if (recursive && force) return "递归强制删除（rm -rf）";
  }

  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) return rule.reason;
  }
  return null;
}

/** 根据按键维护"当前输入行"的影子缓冲；返回更新后的缓冲与可信度。 */
export function trackInput(
  state: { line: string; trustworthy: boolean },
  data: string,
): { line: string; trustworthy: boolean } {
  let { line, trustworthy } = state;
  for (const char of data) {
    if (char === "\r" || char === "\n") {
      return { line, trustworthy };
    }
    if (char === "\x7f" || char === "\b") {
      line = line.slice(0, -1);
      continue;
    }
    if (char === "\x15" || char === "\x03") {
      line = "";
      trustworthy = true;
      continue;
    }
    if (char === "\t" || char === "\x1b") {
      // Tab 补全、方向键（历史命令）会让影子缓冲失真
      trustworthy = false;
      continue;
    }
    if (char >= " " && char !== "\x7f") line += char;
  }
  return { line, trustworthy };
}
