import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatSignedMoney } from '../../shared/money.js';

/** Sets the browser tab title for the page. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Bill Splitter`;
  }, [title]);
}

export function money(cents: number, currency: string): string {
  return formatMoney(cents, currency);
}

/** A balance with sign, word and colour: "+$13.00 is owed" / "−$13.00 owes". */
export function Balance({ cents, currency }: { cents: number; currency: string }) {
  if (cents > 0) {
    return (
      <span className="amount-owed">
        {formatSignedMoney(cents, currency)} <span className="balance-word">is owed</span>
      </span>
    );
  }
  if (cents < 0) {
    return (
      <span className="amount-owes">
        {formatSignedMoney(cents, currency)} <span className="balance-word">owes</span>
      </span>
    );
  }
  return <span className="amount-settled">{formatMoney(0, currency)}</span>;
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  hideLabel?: boolean;
}

/** A labelled text box with its error message linked to it for screen readers. */
export function TextField({ label, value, onChange, error, hint, hideLabel, id, className, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={inputId} className={hideLabel ? 'visually-hidden' : 'field-label'}>
        {label}
      </label>
      {hint && (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      )}
      <input
        id={inputId}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** A password box with an eye button that shows or hides what's typed. */
export function PasswordField({ label, value, onChange, error, hint, autoComplete }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  autoComplete: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {hint && (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      )}
      <div className="password-row">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          // Shown as text, phone keyboards would otherwise capitalise or correct it.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className={shown ? 'eye-button eye-button-on' : 'eye-button'}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-controls={id}
          onClick={() => setShown((s) => !s)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
            {shown && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        </button>
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function ErrorText({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="field-error">
      {children}
    </p>
  );
}

/** A box for page-level problems, read out by screen readers. */
export function Alert({ children, tone = 'error' }: { children?: ReactNode; tone?: 'error' | 'info' }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Grey placeholder shapes while data loads. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-card" role="status" aria-busy="true">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" aria-hidden="true" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/** What to do next when a list is empty. */
export function EmptyState({ text, action }: { text: string; action?: { to: string; label: string; state?: unknown } }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action && (
        <Link className="btn btn-primary" to={action.to} state={action.state}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function PageHeader({ title, children, back }: { title: string; children?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="page-header">
      <div>
        {back && (
          <Link className="back-link" to={back.to}>
            ← {back.label}
          </Link>
        )}
        <h1 tabIndex={-1} className="page-title">
          {title}
        </h1>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

/** "Bill – 21 Oct 2026" style dates for display. */
export function niceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function niceDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
