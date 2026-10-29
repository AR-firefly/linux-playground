"use strict";
/** 平台差异纯函数的单元测试（node:test，跨平台可跑）。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
} = require("./platform");

test("decodeWslText：UTF-16LE 与 UTF-8 都能解", () => {
  assert.equal(decodeWslText(Buffer.from("Ubuntu\n", "utf8")), "Ubuntu\n");
  const utf16 = Buffer.from("Ubuntu\n", "utf16le");
  assert.equal(decodeWslText(utf16), "Ubuntu\n");
  assert.equal(decodeWslText(null), "");
});

test("parseDistroList：识别发行版与默认项", () => {
  const parsed = parseDistroList("Ubuntu\r\nDebian\r\n*Ubuntu\r\n");
  assert.deepEqual(parsed.names, ["Ubuntu", "Debian", "Ubuntu"]);
  assert.equal(parsed.defaultName, "Ubuntu");
  assert.deepEqual(parseDistroList(""), { names: [], defaultName: null });
});

test("classifyPath：区分 windows / posix / relative", () => {
  assert.equal(classifyPath("C:\\Users\\me").kind, "windows");
  assert.equal(classifyPath("\\\\server\\share").kind, "windows");
  assert.equal(classifyPath("/home/me").kind, "posix");
  assert.equal(classifyPath("etc/passwd").kind, "relative");
  assert.equal(classifyPath("").kind, "invalid");
});

test("dirnameFor：按路径语义取父目录", () => {
  assert.equal(dirnameFor("posix", "/home/me/docs"), "/home/me");
  assert.equal(dirnameFor("windows", "C:\\Users\\me\\docs"), "C:\\Users\\me");
});

test("detectScriptFlavor：按探测结果区分 util-linux 与 BSD", () => {
  assert.equal(
    detectScriptFlavor((args) => (args.includes("-c") ? 0 : 1)),
    "util-linux",
  );
  assert.equal(
    detectScriptFlavor((args) => (args.includes("-c") ? 1 : 0)),
    "bsd",
  );
  assert.equal(
    detectScriptFlavor(() => 1),
    "none",
  );
});

test("buildScriptArgs：两种 script 参数不同", () => {
  assert.deepEqual(buildScriptArgs("util-linux", "/bin/bash"), [
    "-qfc",
    "/bin/bash",
    "/dev/null",
  ]);
  assert.deepEqual(buildScriptArgs("bsd", "/bin/zsh"), [
    "-q",
    "/dev/null",
    "/bin/zsh",
  ]);
});

test("buildWslArgs：参数里不含引号与反斜杠", () => {
  const args = buildWslArgs({
    rcB64: encodeBase64(buildRcContent()),
    rcPath: "/tmp/linux-playground-rc",
  });
  assert.equal(args[0], "-e");
  assert.equal(args[1], "bash");
  const command = args[3];
  assert.ok(!command.includes("\\"));
  assert.ok(!command.includes('"'));
  assert.ok(command.includes("/tmp/linux-playground-rc"));
  // script -c 必须拿到整条命令
  assert.ok(command.includes("script -qfc 'bash --rcfile /tmp/linux-playground-rc' /dev/null"));
});

test("buildRcContent：先加载用户 bashrc，再挂 OSC7 hook", () => {
  const content = buildRcContent();
  assert.ok(content.includes(".bashrc"));
  assert.ok(content.includes("PROMPT_COMMAND="));
  assert.ok(content.includes("\\033]7;"));
});

test("buildPromptHook：输出 OSC 7 序列", () => {
  const hook = buildPromptHook();
  assert.ok(hook.includes("\\033]7;file://%s%s"));
  assert.ok(hook.includes("$PWD"));
});

test("buildFindArgs / parseFindOutput：列目录的往返", () => {
  const args = buildFindArgs("/home/me");
  assert.deepEqual(args.slice(0, 3), ["-e", "find", "/home/me"]);
  const entries = parseFindOutput(
    "d\t4096\t1700000000.5\t文档\nf\t12\t1700000001.5\ta.txt\n",
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: "文档",
    kind: "directory",
    size: 4096,
    mtime: 1700000000500,
  });
  assert.equal(entries[1].name, "a.txt");
  assert.equal(entries[1].kind, "file");
});
