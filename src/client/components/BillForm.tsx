import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { ChargeInput, ChargeMode, FieldErrors } from '../../shared/bill.js';
import { MESSAGES } from '../../shared/rules.js';
import { addItemTarget, isBlankItem, newItem, type BillFormState } from '../billEditor.js';
import { ErrorText, TextField } from './ui.js';

interface Member {
  id: string;
  name: string;
}

interface Props {
  kind: 'solo' | 'group';
  state: BillFormState;
  onChange: (next: BillFormState) => void;
  errors: FieldErrors;
  /** The currency symbol, shown on each charge's amount switch ("Rs"). */
  currency: string;
  /** Group bills: the people who can take part (current members). */
  members?: Member[];
  /** Called with a field's error key when that field is edited, so its old message goes away. "items*" means every item field. */
  onFieldEdit?: (key: string) => void;
}

/** Tax, other charges or tip: a number and a % / amount switch. Tapping the switch puts the cursor in the box. */
function ChargeField({
  label,
  charge,
  onChange,
  error,
  optional,
  currency,
  children,
}: {
  label: string;
  charge: ChargeInput;
  onChange: (c: ChargeInput) => void;
  error?: string;
  optional?: boolean;
  currency: string;
  children?: ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const setMode = (mode: ChargeMode) => onChange({ ...charge, mode });
  // A tap or click (not the arrow keys, which give detail 0) puts the cursor in the box.
  const focusBox = (e: MouseEvent) => {
    if (e.detail > 0) inputRef.current?.focus();
  };
  const symbol = currency.trim() || '$';
  return (
    <fieldset className="charge">
      <legend className="visually-hidden">
        {label}
        {optional && ' (optional)'}
      </legend>
      <div className="charge-grid">
        <span className="charge-label" aria-hidden="true">
          {label}
          {optional && <span className="muted"> (optional)</span>}
        </span>
        <label htmlFor={id} className="visually-hidden">
          {label} {charge.mode === 'percent' ? 'percentage' : 'amount'}
        </label>
        <input
          ref={inputRef}
          id={id}
          className="input input-money"
          inputMode="decimal"
          enterKeyHint="done"
          value={charge.value}
          placeholder={optional ? 'None' : '0'}
          onChange={(e) => onChange({ ...charge, value: e.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <div className="segmented unit-switch" role="radiogroup" aria-label={`${label} as`}>
          <label className={charge.mode === 'percent' ? 'seg seg-on' : 'seg'} onClick={focusBox}>
            <input type="radio" name={`${id}-mode`} checked={charge.mode === 'percent'} onChange={() => setMode('percent')} />
            <span aria-hidden="true">%</span>
            <span className="visually-hidden">Percentage</span>
          </label>
          <label className={charge.mode === 'amount' ? 'seg seg-on' : 'seg'} onClick={focusBox}>
            <input type="radio" name={`${id}-mode`} checked={charge.mode === 'amount'} onChange={() => setMode('amount')} />
            <span className="seg-symbol">{symbol}</span>
            <span className="visually-hidden"> amount</span>
          </label>
        </div>
        {error && (
          <p id={errorId} className="field-error charge-error">
            {error}
          </p>
        )}
        {children}
      </div>
    </fieldset>
  );
}

/** Tick boxes drawn as name chips, with "Everyone" first. */
function PeopleChips({
  legend,
  people,
  selected,
  onChange,
  error,
  errorId,
}: {
  legend: ReactNode;
  people: Member[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
  errorId: string;
}) {
  const everyone = people.length > 0 && people.every((p) => selected.includes(p.id));
  if (people.length === 0) {
    return (
      <fieldset className="chips-field">
        {legend}
        <p className="field-hint">Tick who took part first.</p>
        <ErrorText id={errorId}>{error}</ErrorText>
      </fieldset>
    );
  }
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset className="chips-field">
      {legend}
      <div className="chips">
        <button
          type="button"
          className="chip chip-everyone"
          aria-pressed={everyone}
          onClick={() => onChange(everyone ? [] : people.map((p) => p.id))}
        >
          <span>Everyone</span>
        </button>
        {people.map((p) => (
          <label key={p.id} className="chip">
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={() => toggle(p.id)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <span>{p.name}</span>
          </label>
        ))}
      </div>
      <ErrorText id={errorId}>{error}</ErrorText>
    </fieldset>
  );
}

const SPLIT_HINT = {
  equal: 'Everyone who took part pays the same share.',
  itemized: 'Each person pays for the items they had, plus their part of tax, other charges and tip.',
};

/** Items, tax, other charges and tip; for groups also who took part, who paid and how to split. */
export function BillForm({ kind, state, onChange, errors, currency, members = [], onFieldEdit }: Props) {
  const [tooMany, setTooMany] = useState(false);
  const [focusItem, setFocusItem] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<BillFormState>) => onChange({ ...state, ...patch });
  const edited = (...keys: string[]) => keys.forEach((k) => onFieldEdit?.(k));
  const participants = members.filter((m) => state.participantIds.includes(m.id));
  const itemized = kind === 'group' && state.splitMode === 'itemized';
  const splitName = useId();
  const tipOnName = useId();
  const payerId = useId();
  const payerError = useId();
  const participantsError = 'participants-error';

  // A row just added gets the cursor in its name box.
  useEffect(() => {
    if (focusItem === null) return;
    listRef.current?.querySelector<HTMLInputElement>(`[data-item-name="${focusItem}"]`)?.focus();
    setFocusItem(null);
  }, [focusItem, state.items]);

  const setItem = (key: number, patch: Partial<BillFormState['items'][number]>) =>
    set({ items: state.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) });

  const addItem = () => {
    const target = addItemTarget(state);
    if (target === null) {
      setTooMany(true);
      return;
    }
    setTooMany(false);
    // All 200 lines are there, but one is still empty: use that one.
    if (target !== 'new') {
      setFocusItem(target);
      return;
    }
    edited('items');
    const item = newItem();
    set({ items: [...state.items, item] });
    setFocusItem(item.key);
  };

  /** Enter moves on: name → price → the next item (a new one after the last). */
  const onItemKey = (e: KeyboardEvent<HTMLInputElement>, index: number, field: 'name' | 'price') => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Holding Enter down does it once: the repeats neither add lines nor calculate.
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    const item = state.items[index];
    const last = index === state.items.length - 1;
    // Enter on an empty last line ends the list: the form's own Enter (Calculate) takes over.
    // "Empty" is the same test Calculate uses, so a line with people ticked still counts.
    if (last && isBlankItem(state, item)) return;
    e.preventDefault();
    if (field === 'name') {
      listRef.current?.querySelector<HTMLInputElement>(`[data-item-price="${item.key}"]`)?.focus();
    } else if (last) {
      addItem();
    } else {
      setFocusItem(state.items[index + 1].key);
    }
  };

  const setParticipants = (ids: string[]) => {
    const chosen = new Set(ids);
    // Keep the members' own order, the order the server uses for leftover cents.
    const participantIds = members.map((m) => m.id).filter((x) => chosen.has(x));
    // Items keep who shared them: someone unticked just isn't shown or counted until ticked again.
    edited('participants', 'payer');
    set({ participantIds });
  };
  const onBill = (id: string) => state.participantIds.includes(id);

  const setSplit = (splitMode: BillFormState['splitMode']) => {
    set({ splitMode });
    edited('*.sharers');
  };

  return (
    <div className="bill-form">
      <TextField
        label="Bill name"
        hint="Optional. If you leave it empty, it's named after the bill's date."
        value={state.name}
        onChange={(name) => {
          edited('name');
          set({ name });
        }}
        error={errors.name}
        maxLength={200}
      />

      {kind === 'group' && (
        <section className="card-section bill-people" aria-labelledby="people-heading">
          <h2 id="people-heading" className="section-title">
            People
          </h2>
          <PeopleChips
            legend={<legend className="field-label chips-legend">Who took part</legend>}
            people={members}
            selected={state.participantIds}
            onChange={setParticipants}
            error={errors.participants}
            errorId={participantsError}
          />
          <div className="people-row">
            <div className="field">
              <label htmlFor={payerId} className="field-label">
                Who paid
              </label>
              <select
                id={payerId}
                className="input select"
                value={state.payerId !== null && state.participantIds.includes(state.payerId) ? state.payerId : ''}
                onChange={(e) => {
                  edited('payer');
                  set({ payerId: e.target.value || null });
                }}
                aria-invalid={errors.payer ? true : undefined}
                aria-describedby={errors.payer ? payerError : undefined}
              >
                <option value="">Choose who paid</option>
                {participants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <ErrorText id={payerError}>{errors.payer}</ErrorText>
            </div>
            <fieldset className="field">
              <legend className="field-label">How to split</legend>
              <div className="segmented segmented-wide split-switch">
                <label className={state.splitMode === 'equal' ? 'seg seg-on' : 'seg'}>
                  <input type="radio" name={splitName} checked={state.splitMode === 'equal'} onChange={() => setSplit('equal')} />
                  <span>Equally</span>
                </label>
                <label className={state.splitMode === 'itemized' ? 'seg seg-on' : 'seg'}>
                  <input type="radio" name={splitName} checked={state.splitMode === 'itemized'} onChange={() => setSplit('itemized')} />
                  <span>By items</span>
                  <span className="visually-hidden"> (each pays for what they had)</span>
                </label>
              </div>
              <p className="field-hint">{SPLIT_HINT[state.splitMode]}</p>
            </fieldset>
          </div>
        </section>
      )}

      <section className="card-section" aria-labelledby="items-heading">
        <h2 id="items-heading" className="section-title">
          Items
        </h2>
        <div className="item-head" aria-hidden="true">
          <span>Item</span>
          <span>Price</span>
          <span />
        </div>
        <ol className="items" ref={listRef}>
          {state.items.map((item, i) => {
            const n = i + 1;
            return (
              <li key={item.key} className="item-row">
                <div className="item-main">
                  <TextField
                    className="item-name"
                    label={`Item ${n} name`}
                    placeholder={`Item ${n}`}
                    value={item.name}
                    onChange={(name) => {
                      edited(`items.${i}.name`);
                      setItem(item.key, { name });
                    }}
                    onKeyDown={(e) => onItemKey(e, i, 'name')}
                    data-item-name={item.key}
                    error={errors[`items.${i}.name`]}
                    maxLength={200}
                  />
                  <TextField
                    className="item-price"
                    label={`Item ${n} price`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={item.price}
                    onChange={(price) => {
                      edited(`items.${i}.price`);
                      setItem(item.key, { price });
                    }}
                    onKeyDown={(e) => onItemKey(e, i, 'price')}
                    data-item-price={item.key}
                    error={errors[`items.${i}.price`]}
                  />
                  <button
                    type="button"
                    className="icon-btn item-remove"
                    aria-label={`Remove item ${n}`}
                    title="Remove this item"
                    onClick={() => {
                      setTooMany(false);
                      edited('items*');
                      const neighbour = state.items[i + 1] ?? state.items[i - 1];
                      set({ items: state.items.filter((it) => it.key !== item.key) });
                      if (neighbour) setFocusItem(neighbour.key);
                      else addButtonRef.current?.focus();
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                {itemized && (
                  <PeopleChips
                    legend={
                      <legend className="chips-legend item-shared-by">
                        <span aria-hidden="true">Shared by</span>
                        <span className="visually-hidden">Who shared item {n}</span>
                      </legend>
                    }
                    people={participants}
                    selected={item.sharerIds.filter(onBill)}
                    onChange={(shown) => {
                      edited(`items.${i}.sharers`);
                      setItem(item.key, { sharerIds: [...shown, ...item.sharerIds.filter((id) => !onBill(id))] });
                    }}
                    error={errors[`items.${i}.sharers`]}
                    errorId={`items-${i}-sharers-error`}
                  />
                )}
              </li>
            );
          })}
        </ol>
        {errors.items && (
          <p className="field-error" data-error-anchor tabIndex={-1} role="alert">
            {errors.items}
          </p>
        )}
        <button type="button" className="btn add-item" ref={addButtonRef} onClick={addItem}>
          + Add item
        </button>
        <p className="field-hint add-item-hint">With a keyboard, press Enter after a price to start the next item.</p>
        {tooMany && (
          <p className="field-error" role="alert">
            {MESSAGES.tooManyItems}
          </p>
        )}
      </section>

      <section className="card-section charges" aria-labelledby="charges-heading">
        <h2 id="charges-heading" className="section-title">
          Tax, other charges and tip
        </h2>
        <ChargeField
          label="Tax"
          charge={state.tax}
          currency={currency}
          onChange={(tax) => {
            edited('tax');
            set({ tax });
          }}
          error={errors.tax}
        />
        <ChargeField
          label="Other charges"
          optional
          charge={state.otherCharges}
          currency={currency}
          onChange={(otherCharges) => {
            edited('otherCharges');
            set({ otherCharges });
          }}
          error={errors.otherCharges}
        />
        <ChargeField
          label="Tip"
          charge={state.tip}
          currency={currency}
          onChange={(tip) => {
            edited('tip');
            set({ tip });
          }}
          error={errors.tip}
        >
          {state.tip.mode === 'percent' && (
            <fieldset className="tip-on">
              <legend className="visually-hidden">Tip is a % of</legend>
              <span className="field-hint" aria-hidden="true">
                Tip is a % of
              </span>
              <div className="segmented segmented-small">
                <label className={state.tipOn === 'items' ? 'seg seg-on' : 'seg'}>
                  <input type="radio" name={tipOnName} checked={state.tipOn === 'items'} onChange={() => set({ tipOn: 'items' })} />
                  <span>Items only</span>
                </label>
                <label className={state.tipOn === 'items_tax' ? 'seg seg-on' : 'seg'}>
                  <input type="radio" name={tipOnName} checked={state.tipOn === 'items_tax'} onChange={() => set({ tipOn: 'items_tax' })} />
                  <span>Items + tax</span>
                </label>
              </div>
            </fieldset>
          )}
        </ChargeField>
      </section>
    </div>
  );
}
