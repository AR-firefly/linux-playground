import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  displayWidth,
  emptyLine,
  reduceKey,
} from "../src/engine/lineedit";

const type = (state = emptyLine(), text = "") => {
  let current = state;
  for (const char of text) current = reduceKey(current, char).state;
  return current;
};

describe("行编辑：bash 风格键位", () => {
  it("输入、退格、左右移动", () => {
    let state = type(emptyLine(), "ls -la");
    expect(state.line).toBe("ls -la");
    state = reduceKey(state, "\x7f").state;
    expect(state.line).toBe("ls -l");
    state = reduceKey(state, "\x1b[D").state;
    expect(state.cursor).toBe(4);
    state = type(state, "X");
    expect(state.line).toBe("ls -Xl");
  });

  it("Ctrl+A / Ctrl+E / Ctrl+U / Ctrl+K / Ctrl+W", () => {
    let state = type(emptyLine(), "cd 文档");
    state = reduceKey(state, "\x01").state;
    expect(state.cursor).toBe(0);
    state = reduceKey(state, "\x05").state;
    expect(state.cursor).toBe(state.line.length);
    state = reduceKey(state, "\x15").state;
    expect(state.line).toBe("");
    state = type(emptyLine(), "echo hello world");
    state = reduceKey(state, "\x17").state;
    expect(state.line).toBe("echo hello");
    state = reduceKey(state, "\x0b").state;
    expect(state.line).toBe("echo hello");
    state = type(emptyLine(), "abcdef");
    state = reduceKey(state, "\x01").state;
    state = reduceKey(state, "\x0b").state;
    expect(state.line).toBe("");
  });

  it("回车提交、历史上下、Ctrl+C 中断", () => {
    let state = type(emptyLine(), "ls");
    const submitted = reduceKey(state, "\r");
    expect(submitted.action).toEqual({ type: "submit", command: "ls" });
    state = submitted.state;
    expect(state.history).toEqual(["ls"]);

    state = type(state, "pwd");
    state = reduceKey(state, "\r").state;
    expect(state.history).toEqual(["ls", "pwd"]);

    state = reduceKey(state, "\x1b[A").state;
    expect(state.line).toBe("pwd");
    state = reduceKey(state, "\x1b[A").state;
    expect(state.line).toBe("ls");
    state = reduceKey(state, "\x1b[B").state;
    expect(state.line).toBe("pwd");

    const interrupted = reduceKey(type(state, "rm"), "\x03");
    expect(interrupted.action).toEqual({ type: "interrupt" });
    expect(interrupted.state.line).toBe("");
  });

  it("Ctrl+D：空行 EOF，非空删字符", () => {
    const eof = reduceKey(emptyLine(), "\x04");
    expect(eof.action).toEqual({ type: "eof" });
    let atEnd = type(emptyLine(), "ab");
    expect(reduceKey(atEnd, "\x04").state.line).toBe("ab");
    atEnd = reduceKey(atEnd, "\x1b[D").state;
    expect(reduceKey(atEnd, "\x04").state.line).toBe("a");
  });

  it("补全：单候选直接补，多候选列公共前缀", () => {
    const state = type(emptyLine(), "cat re");
    const single = applyCompletion(state, "re", ["readme.txt"]);
    expect(single.state.line).toBe("cat readme.txt");

    const multi = applyCompletion(type(emptyLine(), "cat d"), "d", [
      "data.csv",
      "docs/",
    ]);
    expect(multi.state.line).toBe("cat d");
    expect(multi.listing).toEqual(["data.csv", "docs/"]);
  });

  it("宽字符宽度计算", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("文档")).toBe(4);
    expect(displayWidth("a文")).toBe(3);
  });
});
