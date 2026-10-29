import { useEffect, useState } from "react";
import {
  FlaskConical,
  FolderOpen,
  HardDrive,
  PackageOpen,
  X,
} from "lucide-react";

export type PlayMode = "simulation" | "folder" | "import" | "pty";

interface SettingsModalProps {
  open: boolean;
  mode: PlayMode;
  folderSupported: boolean;
  busy?: "folder" | "import" | "export" | "cmd" | null;
  confirmDanger?: boolean;
  showDangerToggle?: boolean;
  onToggleConfirm?: (value: boolean) => void;
  onClose: () => void;
  onSelect: (mode: PlayMode) => void;
}

export default function SettingsModal({
  open,
  mode,
  folderSupported,
  busy = null,
  confirmDanger = true,
  showDangerToggle = false,
  onToggleConfirm,
  onClose,
  onSelect,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<PlayMode>(mode);
  useEffect(() => {
    if (open) setDraft(mode);
  }, [open, mode]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ENVIRONMENT</span>
            <h2 id="settings-title">选择你想碰的东西</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mode-options">
          <button
            type="button"
            className={`mode-option ${draft === "simulation" ? "selected" : ""}`}
            onClick={() => setDraft("simulation")}
          >
            <FlaskConical size={23} />
            <span>
              <strong>模拟练习</strong>
              <small>浏览器里的虚拟文件，删了也不心疼</small>
            </span>
            <span className="radio-dot" />
          </button>

          <button
            type="button"
            className={`mode-option ${draft === "folder" ? "selected" : ""} ${
              folderSupported ? "" : "is-disabled"
            }`}
            onClick={() => folderSupported && setDraft("folder")}
            aria-disabled={!folderSupported}
          >
            <FolderOpen size={23} />
            <span>
              <strong>连接文件夹（直接改真文件）</strong>
              <small>
                {folderSupported
                  ? "零安装；删改立刻生效，删除进 .trash"
                  : "当前浏览器不支持，请用 Chrome / Edge 打开"}
              </small>
            </span>
            <span className="radio-dot" />
          </button>

          <button
            type="button"
            className={`mode-option ${draft === "import" ? "selected" : ""}`}
            onClick={() => setDraft("import")}
          >
            <PackageOpen size={23} />
            <span>
              <strong>导入文件夹（改完需导出）</strong>
              <small>任何浏览器可用；改的是副本，点「导出 zip」才落盘</small>
            </span>
            <span className="radio-dot" />
          </button>

          <button
            type="button"
            className={`mode-option ${draft === "pty" ? "selected" : ""}`}
            onClick={() => setDraft("pty")}
          >
            <HardDrive size={23} />
            <span>
              <strong>完整 Linux（真终端）</strong>
              <small>本机 Ubuntu/Linux；Linux 能做的都能做</small>
            </span>
            <span className="radio-dot" />
          </button>
        </div>

        {showDangerToggle && (
          <label className="danger-toggle">
            <input
              type="checkbox"
              checked={confirmDanger}
              onChange={(event) => onToggleConfirm?.(event.target.checked)}
            />
            <span>
              <strong>危险命令二次确认</strong>
              <small>
                识别到 rm -rf、dd、mkfs 等命令时先暂停。真实 Linux 不会拦你。
              </small>
            </span>
          </label>
        )}

        <p className="settings-footnote">
          模拟练习不会碰你的电脑；连接文件夹与导入都只作用于你亲手选中的目录。
        </p>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy !== null}
            onClick={() => {
              onSelect(draft);
              onClose();
            }}
          >
            {busy === "folder"
              ? "正在连接…"
              : busy === "import"
                ? "正在导入…"
                : draft === "import"
                  ? "选择要导入的文件夹"
                  : "继续"}
          </button>
        </div>
      </section>
    </div>
  );
}
