import { useId, useState } from 'react';
import type { ChargeInput, ChargeMode, FieldErrors } from '../../shared/bill.js';
import { MESSAGES } from '../../shared/rules.js';
import { canAddItem, newItem, type BillFormState } from '../billEditor.js';
import { PeoplePicker } from './PeoplePicker.js';
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
  /** Group bills: the people who can take part (current members). */
  members?: Member[];
  readOnly?: boolean;
  /** Called with a field's error key when that field is edited, so its old message goes away. "items*" means every item field. */
  onFieldEdit?: (key: string) => void;
}

function ChargeField({
  label,
  charge,
  onChange,
  error,
  optional,
  readOnly,
}: {
  label: string;
  charge: ChargeInput;
  onChange: (c: ChargeInput) => void;
  error?: string;
  optional?: boolean;
  readOnly?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const setMode = (mode: ChargeMode) => onChange({ ...charge, mode });
  return (
    <fieldset className="charge" disabled={readOnly}>
      <legend className="field-label">
        {label}
        {optional && <span className="muted"> (optional)</span>}
      </legend>
      <div className="charge-row">
        <label htmlFor={id} className="visually-hidden">
          {label} {charge.mode === 'percent' ? 'percentage' : 'amount'}
        </label>
        <input
          id={id}
          className="input input-money"
          inputMode="decimal"
          value={charge.value}
          placeholder={optional ? 'None' : '0'}
          onChange={(e) => onChange({ ...charge, value: e.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <div className="segmented" role="radiogroup" aria-label={`${label} as`}>
          <label className={charge.mode === 'percent' ? 'seg seg-on' : 'seg'}>
            <input type="radio" name={`${id}-mode`} checked={charge.mode === 'percent'} onChange={() => setMode('percent')} />
            <span aria-hidden="true">%</span>
            <span className="visually-hidden">Percentage</span>
          </label>
          <label className={charge.mode === 'amount' ? 'seg seg-on' : 'seg'}>
            <input type="radio" name={`${id}-mode`} checked={charge.mode === 'amount'} onChange={() => setMode('amount')} />
            <span>Amount</span>
          </label>
        </div>
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Items, tax, other charges, tip and (for groups) who took part and who paid. */
export function BillForm({ kind, state, onChange, errors, members = [], readOnly, onFieldEdit }: Props) {
  const [tooMany, setTooMany] = useState(false);
  const set = (patch: Partial<BillFormState>) => onChange({ ...state, ...patch });
  const edited = (...keys: string[]) => keys.forEach((k) => onFieldEdit?.(k));
  const participants = members.filter((m) => state.participantIds.includes(m.id));
  const itemized = kind === 'group' && state.splitMode === 'itemized';
  const splitName = useId();
  const tipOnName = useId();
  const payerId = useId();
  const payerError = useId();

  const setItem = (key: number, patch: Partial<BillFormState['items'][number]>) =>
    set({ items: state.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) });

  const addItem = () => {
    if (!canAddItem(state)) {
      setTooMany(true);
      return;
    }
    setTooMany(false);
    edited('items*');
    set({ items: [...state.items, newItem()] });
  };

  const toggleParticipant = (id: string) => {
    const on = state.participantIds.includes(id);
    const chosen = new Set(on ? state.participantIds.filter((x) => x !== id) : [...state.participantIds, id]);
    // Keep the members' own order, the order the server uses for leftover cents.
    const participantIds = members.map((m) => m.id).filter((x) => chosen.has(x));
    // Someone no longer on the bill can't share an item.
    const items = on ? state.items.map((it) => ({ ...it, sharerIds: it.sharerIds.filter((x) => x !== id) })) : state.items;
    edited('participants', 'payer');
    set({ participantIds, items });
  };

  return (
    <div className="bill-form">
      <TextField
        label="Bill name"
        hint="Optional. Left empty, it's named after today's date."
        value={state.name}
        onChange={(name) => {
          edited('name');
          set({ name });
        }}
        error={errors.name}
        readOnly={readOnly}
        maxLength={200}
      />

      {kind === 'group' && (
        <>
          <fieldset className="card-section" disabled={readOnly}>
            <legend className="section-title">Who took part</legend>
            <div className="check-grid">
              {members.map((m) => (
                <label key={m.id} className="check">
                  <input
                    type="checkbox"
                    checked={state.participantIds.includes(m.id)}
                    onChange={() => toggleParticipant(m.id)}
                    aria-invalid={errors.participants ? true : undefined}
                    aria-describedby={errors.participants ? 'participants-error' : undefined}
                  />
                  <span>{m.name}</span>
                </label>
              ))}
            </div>
            <ErrorText id="participants-error">{errors.participants}</ErrorText>
          </fieldset>

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
              disabled={readOnly}
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

          <fieldset className="card-section" disabled={readOnly}>
            <legend className="section-title">How to split</legend>
            <div className="radio-row">
              <label className="check">
                <input
                  type="radio"
                  name={splitName}
                  checked={state.splitMode === 'equal'}
                  onChange={() => {
                    set({ splitMode: 'equal' });
                    edited('*.sharers');
                  }}
                />
                <span>Equally</span>
              </label>
              <label className="check">
                <input
                  type="radio"
                  name={splitName}
                  checked={state.splitMode === 'itemized'}
                  onChange={() => {
                    set({ splitMode: 'itemized' });
                    edited('*.sharers');
                  }}
                />
                <span>By items (each pays for what they had)</span>
              </label>
            </div>
          </fieldset>
        </>
      )}

      <section className="card-section" aria-labelledby="items-heading">
        <h2 id="items-heading" className="section-title">
          Items
        </h2>
        <div className={itemized ? 'item-head item-head-itemized' : 'item-head'} aria-hidden="true">
          <span>Name</span>
          <span>Price</span>
          {itemized && <span>Shared by</span>}
        </div>
        <ol className="items">
          {state.items.map((item, i) => {
            const n = i + 1;
            return (
              <li key={item.key} className={itemized ? 'item-row item-row-itemized' : 'item-row'}>
                <TextField
                  className="item-name"
                  label={`Item ${n} name`}
                  placeholder={`Item ${n}`}
                  value={item.name}
                  onChange={(name) => {
                    edited(`items.${i}.name`);
                    setItem(item.key, { name });
                  }}
                  error={errors[`items.${i}.name`]}
                  readOnly={readOnly}
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
                  error={errors[`items.${i}.price`]}
                  readOnly={readOnly}
                />
                {itemized && (
                  <div className="field item-people">
                    <span className="field-label" aria-hidden="true">
                      Shared by
                    </span>
                    <PeoplePicker
                      label={`Who shared item ${n}`}
                      people={participants}
                      selected={item.sharerIds}
                      onChange={(sharerIds) => {
                        edited(`items.${i}.sharers`);
                        setItem(item.key, { sharerIds });
                      }}
                      error={errors[`items.${i}.sharers`]}
                    />
                  </div>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    className="btn btn-ghost item-remove"
                    onClick={() => {
                      setTooMany(false);
                      edited('items*');
                      set({ items: state.items.filter((it) => it.key !== item.key) });
                    }}
                  >
                    Remove<span className="visually-hidden"> item {n}</span>
                  </button>
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
        {!readOnly && (
          <button type="button" className="btn btn-secondary" onClick={addItem}>
            + Add item
          </button>
        )}
        {tooMany && (
          <p className="field-error" role="alert">
            {MESSAGES.tooManyItems}
          </p>
        )}
      </section>

      <section className="card-section charges" aria-label="Tax, other charges and tip">
        <ChargeField label="Tax" charge={state.tax} onChange={(tax) => {
            edited('tax');
            set({ tax });
          }} error={errors.tax} readOnly={readOnly} />
        <ChargeField
          label="Other charges"
          optional
          charge={state.otherCharges}
          onChange={(otherCharges) => {
            edited('otherCharges');
            set({ otherCharges });
          }}
          error={errors.otherCharges}
          readOnly={readOnly}
        />
        <ChargeField label="Tip" charge={state.tip} onChange={(tip) => {
            edited('tip');
            set({ tip });
          }} error={errors.tip} readOnly={readOnly} />
        {state.tip.mode === 'percent' && (
          <fieldset className="tip-on" disabled={readOnly}>
            <legend className="field-label">Tip is a % of</legend>
            <div className="radio-row">
              <label className="check">
                <input type="radio" name={tipOnName} checked={state.tipOn === 'items'} onChange={() => set({ tipOn: 'items' })} />
                <span>Items only</span>
              </label>
              <label className="check">
                <input type="radio" name={tipOnName} checked={state.tipOn === 'items_tax'} onChange={() => set({ tipOn: 'items_tax' })} />
                <span>Items + tax</span>
              </label>
            </div>
          </fieldset>
        )}
      </section>
    </div>
  );
}
