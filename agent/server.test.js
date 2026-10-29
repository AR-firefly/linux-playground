"use strict";
/** 完整 Linux 网关测试（node:test）。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");
const { createApp, corsOrigin } = require("./server");

function request(port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: urlPath, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function startServer() {
  const server = createApp({
    distDir: null,
    allowedOrigins: ["https://linux-playground.app.workbuddy.host"],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

test("health：返回 PTY 模式、家目录与令牌", async (t) => {
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const health = await request(port, "GET", "/health");
  assert.equal(health.status, 200);
  const body = JSON.parse(health.body);
  assert.equal(body.ok, true);
  assert.equal(body.name, "linux-playground-pty");
  assert.equal(typeof body.home, "string");
  assert.ok(body.home.length > 0);
  assert.equal(typeof body.token, "string");
  assert.equal(body.token.length, 32);
  assert.ok(["node-pty", "script", "script-bsd", "wsl"].includes(body.pty));
});

test("CORS：放行本地与发布域，拒绝其他来源", () => {
  const allowed = ["https://linux-playground.app.workbuddy.host"];
  assert.equal(
    corsOrigin("http://127.0.0.1:5173", allowed),
    "http://127.0.0.1:5173",
  );
  assert.equal(
    corsOrigin("http://localhost:8765", allowed),
    "http://localhost:8765",
  );
  assert.equal(
    corsOrigin("https://linux-playground.app.workbuddy.host", allowed),
    "https://linux-playground.app.workbuddy.host",
  );
  assert.equal(corsOrigin("https://evil.example.com", allowed), null);
  assert.equal(corsOrigin(undefined, allowed), null);
});

test("fs/list：令牌校验与路径校验", async (t) => {
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const auth = { "X-LP-Token": server.lpToken };

  const noToken = await request(port, "GET", "/fs/list");
  assert.equal(noToken.status, 403);

  const relative = await request(port, "GET", "/fs/list?path=etc", auth);
  assert.equal(relative.status, 400);

  const missingPath =
    process.platform === "win32" ? "C:////definitely////not////here" : "/definitely/not/here";
  const missing = await request(
    port,
    "GET",
    `/fs/list?path=${encodeURIComponent(missingPath)}`,
    auth,
  );
  assert.equal(missing.status, 404);

  const home = await request(
    port,
    "GET",
    `/fs/list?path=${encodeURIComponent(os.homedir())}`,
    auth,
  );
  assert.equal(home.status, 200);
  const body = JSON.parse(home.body);
  assert.equal(body.path, os.homedir());
  assert.ok(Array.isArray(body.entries));
});

test("fs/list：列出临时目录内容并区分文件/目录", async (t) => {
  const fs = require("node:fs/promises");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lp-list-"));
  await fs.writeFile(path.join(dir, "a.txt"), "123");
  await fs.mkdir(path.join(dir, "sub"));
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await request(
    port,
    "GET",
    `/fs/list?path=${encodeURIComponent(dir)}`,
    { "X-LP-Token": server.lpToken },
  );
  const body = JSON.parse(result.body);
  const names = body.entries.map((entry) => `${entry.kind}:${entry.name}`);
  assert.ok(names.includes("file:a.txt"));
  assert.ok(names.includes("directory:sub"));
});

test("WebSocket：无令牌或错令牌拒绝握手", async (t) => {
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const bad = await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/pty?token=wrong`);
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("unexpected-response", (_req, res) =>
      resolve(`http-${res.statusCode}`),
    );
    socket.on("error", () => resolve("error"));
  });
  assert.equal(bad, "http-401");
});

test("WebSocket：令牌正确时能建立会话", async (t) => {
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const messages = [];
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/pty?token=${server.lpToken}&cols=80&rows=24`,
  );
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  if (process.platform === "linux") {
    socket.send(JSON.stringify({ t: "i", d: "printf lp-ok\\n\r" }));
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  socket.close();
  const output = messages
    .filter((message) => message.t === "o")
    .map((message) => message.d)
    .join("");
  const exited = messages.some((message) => message.t === "exit");
  assert.ok(output.length > 0 || exited, "应有终端输出或退出事件");
});
