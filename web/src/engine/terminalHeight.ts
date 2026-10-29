/**
 * 终端高度：基准与左栏齐平，输出变长时向下生长，到上限后改为内部滚动。
 * 上限按视口比例算：桌面 70vh，手机 60vh，避免一条输出把页面拉爆。
 */
export const BASE_HEIGHT = 320;
/** 最多长到这么高：再多的输出走终端内部滚动（像真终端一样），而不是把页面拉长 */
export const MAX_HEIGHT = 520;
export const LINE_HEIGHT = 22;
export const VISIBLE_ROWS = 13;

export function countLines(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") count += 1;
  }
  return count;
}

export function heightForLines(lines: number, viewport?: number): number {
  const view =
    viewport ?? (typeof window === "undefined" ? 900 : window.innerHeight);
  const ratio = view < 720 ? 0.6 : 0.7;
  const cap = Math.min(MAX_HEIGHT, Math.round(view * ratio));
  const extra = Math.max(0, lines - VISIBLE_ROWS);
  return Math.min(
    cap,
    Math.max(BASE_HEIGHT, BASE_HEIGHT + extra * LINE_HEIGHT),
  );
}
