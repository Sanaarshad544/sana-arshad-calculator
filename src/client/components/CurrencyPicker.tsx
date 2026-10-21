import { useId } from 'react';
import { CURRENCIES } from '../../shared/rules.js';

interface Props {
  choice: string;
  custom: string;
  onChange: (choice: string, custom: string) => void;
  error?: string;
  note?: string;
}

/** The 13 listed symbols plus "Other" with a typed symbol. Display only: no conversion. */
export function CurrencyPicker({ choice, custom, onChange, error, note }: Props) {
  const selectId = useId();
  const customId = useId();
  const errorId = useId();
  const noteId = useId();
  const describedBy = [note ? noteId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field currency-picker">
      <label htmlFor={selectId} className="field-label">
        Currency
      </label>
      {note && (
        <div id={noteId} className="field-hint">
          {note}
        </div>
      )}
      <div className="currency-row">
        <select
          id={selectId}
          className="input select"
          value={choice}
          onChange={(e) => onChange(e.target.value, custom)}
          aria-describedby={describedBy}
          aria-invalid={error && choice !== 'other' ? true : undefined}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="other">Other</option>
        </select>
        {choice === 'other' && (
          <div className="field">
            <label htmlFor={customId} className="visually-hidden">
              Currency symbol
            </label>
            <input
              id={customId}
              className="input input-short"
              value={custom}
              placeholder="e.g. kr"
              onChange={(e) => onChange(choice, e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
        )}
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
