interface ConfirmDialogProps {
  open: boolean;
  title: string;
  lead: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  lead,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
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
        aria-labelledby="confirm-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CONFIRM</span>
            <h2 id="confirm-title">{title}</h2>
          </div>
        </div>
        <p className="guide-lead">{lead}</p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="button danger-solid"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "正在清空…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
