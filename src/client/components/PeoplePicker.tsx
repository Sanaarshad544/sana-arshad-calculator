import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGES } from '../../shared/rules.js';

interface Person {
  id: string;
  name: string;
}

interface Props {
  label: string;
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}

/**
 * A dropdown with a tick box per person. Closed, it shows the ticked names.
 * Keyboard: Enter/Space opens, arrow keys move, Space ticks, Esc closes.
 */
export function PeoplePicker({ label, people, selected, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const errorId = useId();
  const names = people.filter((p) => selected.includes(p.id)).map((p) => p.name);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    const first = wrapRef.current?.querySelector<HTMLInputElement>('input[type=checkbox]');
    first?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const boxes = Array.from(wrapRef.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? []);
    const i = boxes.indexOf(document.activeElement as HTMLInputElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' && boxes.length) {
      e.preventDefault();
      boxes[(i + 1) % boxes.length].focus();
    } else if (e.key === 'ArrowUp' && boxes.length) {
      e.preventDefault();
      boxes[(i - 1 + boxes.length) % boxes.length].focus();
    }
  };

  return (
    <div className="picker" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`picker-button${names.length ? '' : ' picker-empty'}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="visually-hidden">{label}: </span>
        {names.length ? names.join(', ') : MESSAGES.noSharers}
        <span aria-hidden="true" className="picker-caret">
          ▾
        </span>
      </button>
      {open && (
        <div id={panelId} className="picker-panel" onKeyDown={onPanelKey}>
          <fieldset>
            <legend className="visually-hidden">{label}</legend>
            {people.length === 0 && <p className="muted">Tick who took part first.</p>}
            {people.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            Done
          </button>
        </div>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
