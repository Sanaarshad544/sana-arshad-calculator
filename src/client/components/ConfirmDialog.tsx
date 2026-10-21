import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for actions that delete or remove things. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal pop-up. The browser keeps keyboard focus inside it, and Esc works
 * like Cancel. The safe button is focused first.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', danger, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        // Tab wraps around inside the dialog instead of leaving it.
        if (e.key !== 'Tab') return;
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {children && (
        <div id={bodyId} className="dialog-body">
          {children}
        </div>
      )}
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
