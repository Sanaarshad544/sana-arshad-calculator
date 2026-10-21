import { useEffect, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatSignedMoney } from '../../shared/money.js';

/** Sets the browser tab title for the page. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Bill Splitting Calculator`;
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
    <div className="skeleton-card" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/** What to do next when a list is empty. */
export function EmptyState({ text, action }: { text: string; action?: { to: string; label: string } }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action && (
        <Link className="btn btn-primary" to={action.to}>
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
