import React from "react";

const ICONS = { info: "•", success: "✓", error: "!" };

export function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} onClick={() => onDismiss(t.id)}>
          <span className="toast__icon">{ICONS[t.tone] || "•"}</span>
          <span className="toast__msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
