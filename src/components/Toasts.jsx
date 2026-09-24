import { useCallback, useRef, useState } from 'react';

/** Short confirmations that fade away on their own, e.g. after a download. */
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const next = useRef(1);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text, tone = 'ok') => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);
  return { toasts, toast, dismiss };
}

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <p key={t.id} className={`toast ${t.tone}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {t.tone === 'bad' ? <path d="M8 4v5M8 11.5v.5" /> : <path d="M3 8.5l3 3 7-7" />}
          </svg>
          <span>{t.text}</span>
          <button type="button" className="btn icon tiny" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
          </button>
        </p>
      ))}
    </div>
  );
}
