import { AlertTriangle, FolderLock, X } from "lucide-react";

interface FolderConsentProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function FolderConsent({
  open,
  onCancel,
  onConfirm,
}: FolderConsentProps) {
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
        aria-labelledby="folder-consent-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">REAL FILES</span>
            <h2 id="folder-consent-title">接下来操作的是真文件</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="取消连接文件夹"
          >
            <X size={20} />
          </button>
        </div>

        <ul className="risk-list">
          <li>
            <AlertTriangle size={18} />
            <span>
              <strong>你选哪个文件夹，我们才能碰哪个文件夹。</strong>
              浏览器会弹出系统选择框；除此之外的磁盘内容我们用不了、也看不到。
            </span>
          </li>
          <li>
            <FolderLock size={18} />
            <span>
              <strong>删除是软删除。</strong>
              <code>rm</code> 会把文件移进该文件夹里的 <code>.trash</code>
              ，你可以随时清空回收站，也可以手动恢复。
            </span>
          </li>
          <li>
            <AlertTriangle size={18} />
            <span>
              <strong>改动立刻生效。</strong>
              这里是真磁盘：改名、覆盖、删除都会马上反映到你的文件管理器。权限随时可以在浏览器地址栏撤销。
            </span>
          </li>
        </ul>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="button primary danger"
            onClick={onConfirm}
          >
            我已知晓，选择文件夹
          </button>
        </div>
      </section>
    </div>
  );
}
