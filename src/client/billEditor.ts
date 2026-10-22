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

/** Who shared an item, counting only people on the bill (unticked people's ticks are kept but not used). */
function sharersOnBill(state: BillFormState, item: ItemRow): string[] {
  return item.sharerIds.filter((id) => state.participantIds.includes(id));
}

/**
 * A spare line (e.g. the one Enter adds) has no name, no price and, split by
 * items, nobody ticked: it's left out.
 */
export function isBlankItem(state: BillFormState, item: ItemRow): boolean {
  const ticked = state.splitMode === 'itemized' && sharersOnBill(state, item).length > 0;
  return item.name.trim() === '' && item.price.trim() === '' && !ticked;
}

/** The item lines that count, and where each sits on the form. */
function usedItems(state: BillFormState): { rows: ItemRow[]; positions: number[] } {
  const positions = state.items.flatMap((item, i) => (isBlankItem(state, item) ? [] : [i]));
  return { rows: positions.map((i) => state.items[i]), positions };
}

/**
 * Messages about items are numbered by the lines that count; point them back at
 * the lines on the form, so each shows next to the right box.
 */
export function toFormErrors(state: BillFormState, errors: FieldErrors): FieldErrors {
  const { positions } = usedItems(state);
  const out: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    const m = /^items\.(\d+)\.(.+)$/.exec(key);
    out[m ? `items.${positions[Number(m[1])] ?? m[1]}.${m[2]}` : key] = message;
  }
  return out;
}

export function toBillInput(state: BillFormState): BillInput {
  return {
    name: state.name,
    items: usedItems(state).rows.map((it) => ({ name: it.name, price: it.price })),
    tax: state.tax,
    otherCharges: state.otherCharges,
    tip: state.tip,
    tipOn: state.tipOn,
  };
}

export function toGroupBillInput(state: BillFormState): GroupBillInput {
  return {
    ...toBillInput(state),
    items: usedItems(state).rows.map((it) => ({ name: it.name, price: it.price, sharerIds: sharersOnBill(state, it) })),
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
    if (!checked.ok) return { ok: false, errors: toFormErrors(state, checked.errors) };
    const r = computeGroupBill(checked.value);
    return { ok: true, result: { totals: r.totals, shares: r.shares } };
  }
  const checked = checkBill(toBillInput(state));
  const errors: FieldErrors = checked.ok ? {} : toFormErrors(state, checked.errors);
  if (checkSoloCurrency) {
    const currency = checkCurrency(chosenCurrency(state));
    if (!currency.ok) errors.currency = currency.message;
  }
  if (!checked.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, result: { totals: computeTotals(checked.value), shares: null } };
}

/**
 * Where "+ Add item" (or Enter after the last price) goes: 'new' for a new line;
 * once the bill has all 200 lines, the key of the first spare empty one; or
 * null when every line is in use.
 */
export function addItemTarget(state: BillFormState): 'new' | number | null {
  if (state.items.length < MAX_ITEMS) return 'new';
  return state.items.find((item) => isBlankItem(state, item))?.key ?? null;
}


/** What counts as a change: item keys (React only) and spare empty lines don't. */
export function stripKeys(state: BillFormState) {
  return { ...state, items: usedItems(state).rows.map(({ name, price, sharerIds }) => ({ name, price, sharerIds })) };
}

/** Smooth scrolling, unless the person has asked their device to reduce motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * After Calculate: bring the results into view and move focus there, so they are
 * read out. "nearest" leaves the page still when they're already on screen (beside
 * the form on a computer) and scrolls only as far as needed on a phone.
 * If the person has already clicked into another field, focus stays there.
 */
export function revealResults(results: HTMLElement | null): void {
  const focusedAtCalculate = document.activeElement;
  window.setTimeout(() => {
    const now = document.activeElement;
    if (now !== focusedAtCalculate && now !== document.body && now !== null) return;
    results?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
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
  // A blank or zero box counts as nothing, so it gets no rate.
  const pct = (c: ChargeInput) => {
    if (c.mode !== 'percent' || c.value.trim() === '') return null;
    const bp = parseHundredths(c.value);
    return bp === null || bp === 0 ? null : `${formatPercent(bp)}%`;
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
