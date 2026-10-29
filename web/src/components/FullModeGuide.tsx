import { TerminalSquare, X } from "lucide-react";

interface FullModeGuideProps {
  open: boolean;
  onClose: () => void;
}

export default function FullModeGuide({ open, onClose }: FullModeGuideProps) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal consent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-guide-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">FULL LINUX</span>
            <h2 id="full-guide-title">完整 Linux 需要在本机启动一个组件</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭说明"
          >
            <X size={20} />
          </button>
        </div>

        <p className="guide-lead">
          网页本身碰不到你的系统，浏览器只当显示器；真正的终端跑在你自己的机器上。
          在项目目录里执行：
        </p>
        <pre className="install-guide">
          <code>{`cd LinuxPlayground
npm install
npm run real`}</code>
        </pre>
        <p className="guide-lead">
          （在已获取的项目目录里执行；源码地址见 README。）
        </p>
        <p className="guide-lead">
          启动后它会打印一个本地地址（默认 <code>http://127.0.0.1:8765</code>
          ），用浏览器打开那个页面，即可切到 「完整
          Linux」，直接敲命令。线上页面与本地网关不同源，WebSocket
          无法跨源连接，所以完整模式只在本地页面里可用——这是浏览器的底线，不是我们的取舍。
        </p>
        <p className="guide-lead">
          Windows：装过 WSL 的话直接在这里跑，网关会自动连进你的 Ubuntu（Ubuntu
          里不用装 Node）；还没装的话，先在管理员终端执行{" "}
          <code>wsl --install -d Ubuntu</code>，重启后再执行上面三行。
        </p>
        <p className="guide-lead">
          macOS 与 Linux 同样适用：直接执行上面三行。macOS 用系统自带的 script
          提供终端，Linux 用原生 script（装 node-pty 可让窗口自适应）。
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            知道了
          </button>
          <a
            className="button primary"
            href="http://127.0.0.1:8765"
            target="_blank"
            rel="noreferrer"
          >
            <TerminalSquare size={16} /> 我已启动，打开本地页面
          </a>
        </div>
      </section>
    </div>
  );
}
