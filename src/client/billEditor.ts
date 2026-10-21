// Form state for the bill screens, and the Calculate step (the same checks and
// maths the server uses when saving).

import {
  checkBill,
  checkGroupBill,
  computeGroupBill,
  computeTotals,
  type BillInput,
  type ChargeInput,
  type FieldErrors,
  type GroupBillInput,
  type Share,
  type SplitMode,
  type TipOn,
  type Totals,
} from '../shared/bill.js';
import { CURRENCIES, MAX_ITEMS, checkCurrency } from '../shared/rules.js';
import { formatPercent, parseHundredths } from '../shared/money.js';

export interface ItemRow {
  key: number;
  name: string;
  price: string;
  sharerIds: string[];
}

export interface BillFormState {
  name: string;
  items: ItemRow[];
  tax: ChargeInput;
  otherCharges: ChargeInput;
  tip: ChargeInput;
  tipOn: TipOn;
  /** Solo bills: one of the listed symbols, or "other". */
  currencyChoice: string;
  customCurrency: string;
  /** Group bills. */
  splitMode: SplitMode;
  participantIds: string[];
  payerId: string | null;
}

let nextKey = 1;
export const newItem = (over: Partial<ItemRow> = {}): ItemRow => ({ key: nextKey++, name: '', price: '', sharerIds: [], ...over });

export function emptyBill(over: Partial<BillFormState> = {}): BillFormState {
  return {
    name: '',
    items: [newItem()],
    // Blank means 0, so typing starts from an empty box ("5", not "05").
    tax: { mode: 'percent', value: '' },
    otherCharges: { mode: 'amount', value: '' },
    tip: { mode: 'percent', value: '' },
    tipOn: 'items',
    currencyChoice: '$',
    customCurrency: '',
    splitMode: 'equal',
    participantIds: [],
    payerId: null,
    ...over,
  };
}

/** Rebuilds the form from a saved bill. */
export function fromInput(input: BillInput | GroupBillInput, currency?: string): BillFormState {
  const group = input as Partial<GroupBillInput>;
  const listed = currency !== undefined && (CURRENCIES as readonly string[]).includes(currency);
  return emptyBill({
    name: input.name,
    items: input.items.map((it) => newItem({ name: it.name, price: it.price, sharerIds: it.sharerIds ?? [] })),
    tax: input.tax,
    otherCharges: input.otherCharges,
    tip: input.tip,
    tipOn: input.tipOn,
    currencyChoice: currency === undefined ? '$' : listed ? currency : 'other',
    customCurrency: currency !== undefined && !listed ? currency : '',
    splitMode: group.splitMode ?? 'equal',
    participantIds: group.participantIds ?? [],
    payerId: group.payerId ?? null,
  });
}

export function toBillInput(state: BillFormState): BillInput {
  return {
    name: state.name,
    items: state.items.map((it) => ({ name: it.name, price: it.price })),
    tax: state.tax,
    otherCharges: state.otherCharges,
    tip: state.tip,
    tipOn: state.tipOn,
  };
}

export function toGroupBillInput(state: BillFormState): GroupBillInput {
  return {
    ...toBillInput(state),
    items: state.items.map((it) => ({ name: it.name, price: it.price, sharerIds: it.sharerIds })),
    splitMode: state.splitMode,
    participantIds: state.participantIds,
    payerId: state.payerId,
  };
}

export function chosenCurrency(state: BillFormState): string {
  return state.currencyChoice === 'other' ? state.customCurrency : state.currencyChoice;
}

export interface CalcResult {
  totals: Totals;
  shares: Share[] | null;
}

export type CalcOutcome = { ok: true; result: CalcResult } | { ok: false; errors: FieldErrors };

/** Runs every check; returns the result only when everything is valid. */
export function calculate(state: BillFormState, kind: 'solo' | 'group', checkSoloCurrency: boolean): CalcOutcome {
  if (kind === 'group') {
    const checked = checkGroupBill(toGroupBillInput(state));
    if (!checked.ok) return { ok: false, errors: checked.errors };
    const r = computeGroupBill(checked.value);
    return { ok: true, result: { totals: r.totals, shares: r.shares } };
  }
  const checked = checkBill(toBillInput(state));
  const errors: FieldErrors = checked.ok ? {} : { ...checked.errors };
  if (checkSoloCurrency) {
    const currency = checkCurrency(chosenCurrency(state));
    if (!currency.ok) errors.currency = currency.message;
  }
  if (!checked.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, result: { totals: computeTotals(checked.value), shares: null } };
}

export function canAddItem(state: BillFormState): boolean {
  return state.items.length < MAX_ITEMS;
}


/** Item keys are only for React; they don't count as unsaved changes. */
export function stripKeys(state: BillFormState) {
  return { ...state, items: state.items.map(({ name, price, sharerIds }) => ({ name, price, sharerIds })) };
}

/** Smooth scrolling, unless the person has asked their device to reduce motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/** After Calculate: bring the results into view and move focus there, so they are read out. */
export function revealResults(results: HTMLElement | null): void {
  window.setTimeout(() => {
    results?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    results?.focus({ preventScroll: true });
  }, 0);
}

/** Moves keyboard focus to the first field with a problem. */
export function focusFirstError(root: HTMLElement | null): void {
  const target = root?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-anchor]');
  target?.focus();
}

export interface RateLabels {
  tax: string;
  other: string;
  tip: string;
}

/** The rate behind each results line: "(5%)", "(15% of items + tax)". Blank for amounts. */
export function rateLabels(state: BillFormState): RateLabels {
  // A blank box counts as nothing, so it gets no rate.
  const pct = (c: ChargeInput) => {
    if (c.mode !== 'percent' || c.value.trim() === '') return null;
    const bp = parseHundredths(c.value);
    return bp === null ? null : `${formatPercent(bp)}%`;
  };
  const tax = pct(state.tax);
  const other = pct(state.otherCharges);
  const tip = pct(state.tip);
  return {
    tax: tax ? `(${tax})` : '',
    other: other ? `(${other})` : '',
    tip: tip ? `(${tip} of ${state.tipOn === 'items_tax' ? 'items + tax' : 'items'})` : '',
  };
}
