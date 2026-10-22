import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'done' | 'error';

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

type ShowToast = (text: string, kind?: ToastKind) => void;

const ToastContext = createContext<ShowToast>(() => {});

/**
 * Short messages in the corner: what just happened (gone after 5 seconds), or,
 * in red, a change that failed after its page was left (gone after 10 seconds).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const show = useCallback<ShowToast>((text, kind = 'done') => {
    const id = next.current++;
    setToasts((list) => [...list, { id, text, kind }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 10_000 : 5000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.kind === 'error' ? 'toast toast-error' : 'toast'}>
            <span aria-hidden="true" className="toast-icon">
              {t.kind === 'error' ? '!' : '✓'}
            </span>{' '}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
