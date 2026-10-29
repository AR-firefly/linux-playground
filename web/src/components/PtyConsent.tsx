import { AlertTriangle, Terminal, X } from "lucide-react";

interface PtyConsentProps {
  open: boolean;
  ptyMode: "node-pty" | "script" | "script-bsd" | "wsl";
  confirmDanger: boolean;
  onToggleConfirm: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PtyConsent({
  open,
  ptyMode,
  confirmDanger,
  onToggleConfirm,
  onCancel,
  onConfirm,
}: PtyConsentProps) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="settings-modal consent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pty-consent-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">FULL LINUX</span>
            <h2 id="pty-consent-title">接下来是真正的终端</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="取消完整 Linux 模式"
          >
            <X size={20} />
          </button>
        </div>

        <ul className="risk-list">
          <li>
            <Terminal size={18} />
            <span>
              <strong>命令直接在你本机的 shell 里执行。</strong>
              不是模拟，也不是练习目录：能装软件、能删家目录、能改系统设置。
              {ptyMode === "script" && (
                <>
                  {" "}
                  当前使用零编译 PTY（script），vim/top
                  等全屏程序的窗口尺寸固定。
                </>
              )}
              {ptyMode === "script-bsd" && (
                <>
                  {" "}
                  当前使用 macOS 系统自带的 script 提供 PTY，vim/top
                  等全屏程序的窗口尺寸固定。
                </>
              )}
              {ptyMode === "wsl" && (
                <>
                  {" "}
                  当前经 wsl.exe 连接你 WSL 里的 Linux（Ubuntu
                  内无需安装 Node），vim/top 等全屏程序的窗口尺寸固定。
                </>
              )}
            </span>
          </li>
          <li>
            <AlertTriangle size={18} />
            <span>
              <strong>出问题我们兜不住。</strong>
              你的账号权限就是它的权限边界；误操作造成的损失无法撤销。
            </span>
          </li>
        </ul>

        <label className="danger-toggle">
          <input
            type="checkbox"
            checked={confirmDanger}
            onChange={(event) => onToggleConfirm(event.target.checked)}
          />
          <span>
            <strong>危险命令二次确认</strong>
            <small>
              识别到 rm -rf、dd、mkfs、curl | sh 等命令时先弹窗确认。
            </small>
          </span>
        </label>
        {!confirmDanger && (
          <p className="danger-warning">
            已关闭二次确认：真实 Linux
            不会替你拦住任何命令，请自行确认每一条输入。
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="button primary danger"
            onClick={onConfirm}
          >
            我已知晓，进入完整 Linux
          </button>
        </div>
      </section>
    </div>
  );
}
