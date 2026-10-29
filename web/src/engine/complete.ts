/** 补全的纯逻辑：把光标前的 token 拆成目录部分与待补全前缀。 */

export function splitPrefix(
  line: string,
  cursor: number,
): { dir: string; base: string } {
  const before = line.slice(0, cursor);
  const match = /([^\s]*)$/.exec(before);
  const token = match ? match[1] : "";
  const slash = token.lastIndexOf("/");
  if (slash === -1) return { dir: "", base: token };
  return { dir: token.slice(0, slash + 1), base: token.slice(slash + 1) };
}

/** names 由调用方提供（目录名以 / 结尾），返回按字典序排列的候选。 */
export function completeCandidates(base: string, names: string[]): string[] {
  return names.filter((name) => name.startsWith(base)).sort();
}
