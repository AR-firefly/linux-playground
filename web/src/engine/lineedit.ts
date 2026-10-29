/** bash 风格的行编辑状态机（纯函数，便于单测）。 */

export interface LineState {
  line: string;
  cursor: number;
  history: string[];
  historyIndex: number;
  savedLine: string;
}

export const emptyLine = (): LineState => ({
  line: "",
  cursor: 0,
  history: [],
  historyIndex: -1,
  savedLine: "",
});

export type LineAction =
  | { type: "edit" }
  | { type: "submit"; command: string }
  | { type: "interrupt" }
  | { type: "eof" }
  | { type: "clear-screen" }
  | { type: "complete"; prefix: string }
  | { type: "paste" }
  | { type: "none" };

const insert = (state: LineState, text: string): LineState => {
  const before = state.line.slice(0, state.cursor);
  const after = state.line.slice(state.cursor);
  const line = before + text + after;
  return { ...state, line, cursor: state.cursor + text.length };
};

function historyMove(state: LineState, delta: number): LineState {
  if (!state.history.length) return state;
  const current =
    state.historyIndex === -1 ? state.history.length : state.historyIndex;
  const next = Math.min(state.history.length, Math.max(0, current + delta));
  if (next === state.historyIndex) return state;
  if (state.historyIndex === -1 && next < state.history.length) {
    state = { ...state, savedLine: state.line };
  }
  const line =
    next === state.history.length ? state.savedLine : state.history[next];
  return {
    ...state,
    line,
    cursor: line.length,
    historyIndex: next === state.history.length ? -1 : next,
  };
}

/** 返回新状态与需要执行的动作。 */
export function reduceKey(
  state: LineState,
  data: string,
): { state: LineState; action: LineAction } {
  const done = (next: LineState, action: LineAction = { type: "edit" }) => ({
    state: next,
    action,
  });

  if (data === "\r" || data === "\n") {
    const command = state.line.trim();
    if (!command) {
      return done({ ...state, line: "", cursor: 0 }, { type: "none" });
    }
    const history =
      state.history[state.history.length - 1] === command
        ? state.history
        : [...state.history, command].slice(-100);
    return {
      state: {
        ...state,
        line: "",
        cursor: 0,
        history,
        historyIndex: -1,
        savedLine: "",
      },
      action: { type: "submit", command: state.line },
    };
  }

  if (data === "\x03") {
    return done({ ...state, line: "", cursor: 0 }, { type: "interrupt" });
  }
  if (data === "\x04") {
    if (!state.line) {
      return done({ ...state, line: "", cursor: 0 }, { type: "eof" });
    }
    return done({
      ...state,
      line:
        state.line.slice(0, state.cursor) + state.line.slice(state.cursor + 1),
    });
  }
  if (data === "\x0c") return done(state, { type: "clear-screen" });
  if (data === "\x01") return done({ ...state, cursor: 0 });
  if (data === "\x05") return done({ ...state, cursor: state.line.length });
  if (data === "\x15") {
    return done({ ...state, line: state.line.slice(state.cursor), cursor: 0 });
  }
  if (data === "\x0b") {
    return done({ ...state, line: state.line.slice(0, state.cursor) });
  }
  if (data === "\x17") {
    const before = state.line.slice(0, state.cursor).replace(/\s*\S+$/, "");
    return done({
      ...state,
      line: before + state.line.slice(state.cursor),
      cursor: before.length,
    });
  }
  if (data === "\x16") return done(state, { type: "paste" });
  if (data === "\t") {
    const before = state.line.slice(0, state.cursor);
    const match = /([^\s]*)$/.exec(before);
    return done(state, { type: "complete", prefix: match ? match[1] : "" });
  }
  if (data === "\x7f") {
    if (state.cursor === 0) return done(state);
    const line =
      state.line.slice(0, state.cursor - 1) + state.line.slice(state.cursor);
    return done({ ...state, line, cursor: state.cursor - 1 });
  }
  if (data === "\x1b[3~") {
    return done({
      ...state,
      line:
        state.line.slice(0, state.cursor) + state.line.slice(state.cursor + 1),
    });
  }
  if (data === "\x1b[D") {
    return done({ ...state, cursor: Math.max(0, state.cursor - 1) });
  }
  if (data === "\x1b[C") {
    return done({
      ...state,
      cursor: Math.min(state.line.length, state.cursor + 1),
    });
  }
  if (data === "\x1b[H") return done({ ...state, cursor: 0 });
  if (data === "\x1b[F") return done({ ...state, cursor: state.line.length });
  if (data === "\x1b[A") return done(historyMove(state, -1));
  if (data === "\x1b[B") return done(historyMove(state, 1));

  // 粘贴：去掉回车换行，保留可打印内容
  const text = data
    .replace(/[\r\n]+/g, " ")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  if (!text) return done(state);
  return done(insert(state, text));
}

/** 把补全结果应用到行上：单候选直接补，多候选返回列表。 */
export function applyCompletion(
  state: LineState,
  prefix: string,
  candidates: string[],
): { state: LineState; listing: string[] } {
  if (!candidates.length) return { state, listing: [] };
  if (candidates.length === 1) {
    const line =
      state.line.slice(0, state.cursor - prefix.length) +
      candidates[0] +
      state.line.slice(state.cursor);
    const cursor = state.cursor - prefix.length + candidates[0].length;
    return { state: { ...state, line, cursor }, listing: [] };
  }
  const common = candidates.reduce((acc, item) => {
    let index = 0;
    while (
      index < acc.length &&
      index < item.length &&
      acc[index] === item[index]
    ) {
      index += 1;
    }
    return acc.slice(0, index);
  });
  if (common.length > prefix.length) {
    const line =
      state.line.slice(0, state.cursor - prefix.length) +
      common +
      state.line.slice(state.cursor);
    return {
      state: {
        ...state,
        line,
        cursor: state.cursor - prefix.length + common.length,
      },
      listing: candidates,
    };
  }
  return { state, listing: candidates };
}

/** CJK 宽字符按 2 列计算，用于光标回退。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1;
  }
  return width;
}
