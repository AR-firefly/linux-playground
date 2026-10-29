# 完整 Linux 模式（真终端）

> 对应需求文档 v1.10 的 4.5（4）。**已实现**：本机网关 + PTY + WebSocket，浏览器里就是货真价实的 shell。

## 它是什么

```
浏览器（xterm.js）
   │  WebSocket（127.0.0.1，令牌校验）
本机网关（Node）
   │  PTY（Linux 直连 / macOS script / Windows 经 wsl.exe）
你的 shell（你的账号权限）
```

- 不是模拟：命令在你自己的机器上执行，能装软件、能删文件、能改系统设置。
- 只有本地页面能用：网关同时托管网页，页面与 WebSocket 同源；线上 https 页面无法直连 `ws://127.0.0.1`（浏览器混合内容限制）。
- 网页永远碰不到别人的电脑：网关只监听 `127.0.0.1`，每次启动随机令牌。

## 启动（三平台）

### Windows（WSL）：不用装任何东西

```bash
npm install
npm run real
```

网关跑在 Windows 上，PTY 通过 `wsl.exe` 进入 WSL 里的 Linux，由那里的 `script` 分配终端。**不需要在 Ubuntu 里装 Node，也不需要 node-pty，不需要 sudo。**

需要：已安装 WSL（管理员终端 `wsl --install -d Ubuntu`，装完重启并设置用户名密码）。

### macOS：原生，零安装

```bash
npm install && npm run real
```

用系统自带的 `script` 提供 PTY（macOS 的 `script` 参数与 Linux 版不同，网关会自动探测）。`vim`/`top` 可用，但窗口尺寸固定。

### Linux：原生

```bash
npm install && npm run real
```

可选：`npm install node-pty` 获得窗口自适应与更好的全屏程序支持。

启动后打开它打印的地址（默认 `http://127.0.0.1:8765`）→ 环境设置 → 完整 Linux → 我已知晓。

## PTY 档位

| 档位         | 条件                            | 差异                                                |
| ------------ | ------------------------------- | --------------------------------------------------- |
| `node-pty`   | Linux 上 `npm install node-pty` | 完整终端：vim/top 正常，窗口尺寸自适应              |
| `script`     | Linux 自带（默认）              | 零编译；全屏程序尺寸固定                            |
| `script-bsd` | macOS 自带（默认）              | 零编译；全屏程序尺寸固定                            |
| `wsl`        | Windows + 已装 WSL              | 经 `wsl.exe` 使用 WSL 里的 script；全屏程序尺寸固定 |

启动时会打印当前档位。

## 安全

- 只监听 `127.0.0.1`；每次启动随机令牌，WebSocket 握手与 `/fs/list` 都校验。
- 切换模式必须确认（真机、全权限、不可撤销）。
- 危险命令暂停确认（`rm -rf`、`rm -rf ~`、`dd` 写块设备、`mkfs`、`shred`、`chmod -R 777 /`、`curl | sh`、写 `/dev/sdX`、fork 炸弹），可关闭。
- 真实 Linux 不会拦你，确认框只是练习期的提醒。

## 与真实 Linux 的边界

- 真机模式原样转发 shell：历史、补全、信号、退出全部由 bash 负责。
- 唯一附加动作：有选中时的 `Ctrl+C` 复制（不发送 SIGINT），以及上面那道可关闭的确认。
- 连按两次 `Ctrl+C` 不会退出（那是 python/node 的 REPL 行为），退出请用 `exit` 或 `Ctrl+D`。

## 已知边界

- Windows 未安装 WSL 时无法使用完整模式，会给出明确提示；模拟/文件夹/导入不受影响。
- macOS 路径**未经实机验证**（开发环境无法运行 macOS），仅用单元测试锁定了参数构造。
- 令牌放在 WebSocket URL 查询串里（浏览器无法给 WebSocket 加自定义头），仅限本机回环。
- `/fs/list` 只读，用于文件树；写操作全部走 shell。
- 全屏程序（`vim`/`top`）在 `script` 方案下窗口尺寸固定，需要自适应请装 `node-pty`。
