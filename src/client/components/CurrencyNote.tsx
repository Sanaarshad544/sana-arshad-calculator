import { useId, useState } from 'react';

/** "Currency: Rs" with a small info button that explains it's only a symbol. */
export function CurrencyNote({ currency, className }: { currency: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <div className={`currency-note ${className ?? ''}`}>
      <p className="muted currency-line">
        Currency: <strong className="currency-symbol">{currency}</strong>
        <button
          type="button"
          className="info-btn"
          aria-expanded={open}
          aria-controls={noteId}
          title="About the currency"
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 10.5v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="7.4" r="1.25" fill="currentColor" />
          </svg>
          <span className="visually-hidden">About the currency</span>
        </button>
      </p>
      <div id={noteId} className="info-note" hidden={!open}>
        <p>
          <strong>{currency}</strong> is only a symbol shown next to amounts. Nothing is converted between currencies.
        </p>
        <p>
          Changing the group's currency in Edit group changes the symbol on every bill in this group. The numbers stay exactly the
          same.
        </p>
      </div>
    </div>
  );
}
