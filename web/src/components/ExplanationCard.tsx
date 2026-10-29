import { CornerDownRight, Info } from "lucide-react";
import type { Preview } from "../engine/preview";

export type ExplainPhase = "preview" | "result";

interface ExplanationCardProps {
  command: string;
  explanation: string;
  note?: string;
  phase?: ExplainPhase;
  line?: string;
  preview?: Preview | null;
}

export default function ExplanationCard({
  command,
  explanation,
  note,
  phase = "result",
  line = "",
  preview = null,
}: ExplanationCardProps) {
  const showPreview =
    phase === "preview" && Boolean(preview) && Boolean(line.trim());
  const risk = showPreview && preview ? preview.risk : "none";

  return (
    <aside
      className={`explanation-card risk-${risk}`}
      data-phase={showPreview ? "preview" : "result"}
      aria-live={showPreview ? "off" : "polite"}
    >
      <div className="explanation-icon">
        <CornerDownRight size={20} strokeWidth={2.2} />
      </div>
      <div className="explanation-body">
        <div className="explanation-kicker">
          {showPreview ? "还没执行 · 先看清楚" : "刚发生了什么？"}
        </div>
        {showPreview && preview ? (
          <>
            <code className="explanation-command">{line}</code>
            <p className="explain-title">{preview.title}</p>
            {preview.flags.length > 0 && (
              <ul className="explain-flags">
                {preview.flags.map((item) => (
                  <li key={item.flag}>
                    <code>{item.flag}</code>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.detail && (
              <pre className="explain-detail">{preview.detail}</pre>
            )}
            {preview.warning && (
              <p className="explain-warning">⚠ {preview.warning}</p>
            )}
            {preview.note && <p className="explain-note">{preview.note}</p>}
            <p className="explain-hint">按回车才会执行</p>
          </>
        ) : (
          <>
            {command ? (
              <code className="explanation-command">{command}</code>
            ) : null}
            <p>
              {explanation ||
                "输入一条命令，或点击左侧文件。这里会用一句大白话解释它。"}
            </p>
            {note ? (
              <div className="permission-note">
                <Info size={13} /> {note}
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
