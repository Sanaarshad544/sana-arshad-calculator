// Bill input checking and calculation, shared by the page (Calculate) and the
// server (Save). All money is whole cents; percentages are hundredths of a %.

import { MAX_FIELD_CENTS, MAX_PERCENT_BP, parseHundredths, percentOf } from './money.js';
import { MAX_ITEMS, MESSAGES, charCount } from './rules.js';

export type ChargeMode = 'percent' | 'amount';
export type TipOn = 'items' | 'items_tax';
export type SplitMode = 'equal' | 'itemized';

/** Raw form values, exactly as typed. */
export interface ChargeInput {
  mode: ChargeMode;
  value: string;
}
export interface ItemInput {
  name: string;
  price: string;
  /** Member ids that shared this item (itemized group bills only). */
  sharerIds?: string[];
}
export interface BillInput {
  name: string;
  items: ItemInput[];
  tax: ChargeInput;
  otherCharges: ChargeInput;
  tip: ChargeInput;
  tipOn: TipOn;
}
export interface GroupBillInput extends BillInput {
  splitMode: SplitMode;
  participantIds: string[];
  payerId: string | null;
}

/** Checked values. `value` is cents for amounts and basis points for percentages. */
export interface Charge {
  mode: ChargeMode;
  value: number;
}
export interface Item {
  name: string;
  priceCents: number;
  sharerIds: string[];
}
export interface Bill {
  name: string;
  items: Item[];
  tax: Charge;
  /** value 0 means "no other charges". */
  otherCharges: Charge;
  tip: Charge;
  tipOn: TipOn;
}
export interface GroupBill extends Bill {
  splitMode: SplitMode;
  participantIds: string[];
  payerId: string;
}

export type FieldErrors = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function checkCharge(
  input: ChargeInput,
  amountMessage: string,
  percentMessage: string,
): Charge | string {
  const mode = input.mode === 'percent' ? 'percent' : 'amount';
  const value = parseHundredths(String(input.value ?? ''));
  const max = mode === 'percent' ? MAX_PERCENT_BP : MAX_FIELD_CENTS;
  if (value === null || value > max) return mode === 'percent' ? percentMessage : amountMessage;
  return { mode, value };
}

function checkOtherCharges(input: ChargeInput): Charge | string {
  const mode = input.mode === 'percent' ? 'percent' : 'amount';
  const raw = String(input.value ?? '').trim();
  if (raw === '') return { mode, value: 0 };
  const value = parseHundredths(raw);
  const message = mode === 'percent' ? MESSAGES.otherPercent : MESSAGES.otherAmount;
  if (value === null) return message;
  if (value === 0) return { mode, value: 0 };
  return value <= (mode === 'percent' ? MAX_PERCENT_BP : MAX_FIELD_CENTS) ? { mode, value } : message;
}

/** Checks the parts every bill shares: name, items, tax, other charges, tip. */
export function checkBill(input: BillInput): Checked<Bill> {
  const errors: FieldErrors = {};
  const name = String(input.name ?? '').trim();
  if (charCount(name) > 60) errors.name = MESSAGES.billName;

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0) errors.items = MESSAGES.noItems;
  if (rawItems.length > MAX_ITEMS) errors.items = MESSAGES.tooManyItems;

  const items: Item[] = rawItems.slice(0, MAX_ITEMS).map((item, i) => {
    const itemName = String(item?.name ?? '').trim();
    if (charCount(itemName) > 40) errors[`items.${i}.name`] = MESSAGES.itemName;
    const price = parseHundredths(String(item?.price ?? ''));
    if (price === null || price < 1 || price > MAX_FIELD_CENTS) errors[`items.${i}.price`] = MESSAGES.price;
    const sharerIds = Array.isArray(item?.sharerIds) ? [...new Set(item.sharerIds.map(String))] : [];
    return { name: itemName, priceCents: price ?? 0, sharerIds };
  });

  const tax = checkCharge(input.tax ?? { mode: 'amount', value: '' }, MESSAGES.taxAmount, MESSAGES.taxPercent);
  if (typeof tax === 'string') errors.tax = tax;
  const tip = checkCharge(input.tip ?? { mode: 'amount', value: '' }, MESSAGES.tipAmount, MESSAGES.tipPercent);
  if (typeof tip === 'string') errors.tip = tip;
  const other = checkOtherCharges(input.otherCharges ?? { mode: 'amount', value: '' });
  if (typeof other === 'string') errors.otherCharges = other;
  const tipOn: TipOn = input.tipOn === 'items_tax' ? 'items_tax' : 'items';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, items, tax: tax as Charge, otherCharges: other as Charge, tip: tip as Charge, tipOn },
  };
}

/** Checks a group bill: the common parts plus who took part, who paid and who shared each item. */
export function checkGroupBill(input: GroupBillInput): Checked<GroupBill> {
  const base = checkBill(input);
  const errors: FieldErrors = base.ok ? {} : { ...base.errors };
  const splitMode: SplitMode = input.splitMode === 'itemized' ? 'itemized' : 'equal';
  const participantIds = Array.isArray(input.participantIds) ? [...new Set(input.participantIds.map(String))] : [];
  if (participantIds.length === 0) errors.participants = MESSAGES.noParticipants;

  const payerId = input.payerId == null || input.payerId === '' ? null : String(input.payerId);
  if (payerId === null) errors.payer = MESSAGES.noPayer;
  else if (!participantIds.includes(payerId)) errors.payer = MESSAGES.payerNotParticipant;

  if (splitMode === 'itemized') {
    (Array.isArray(input.items) ? input.items : []).slice(0, MAX_ITEMS).forEach((item, i) => {
      const sharers = Array.isArray(item?.sharerIds) ? item.sharerIds.map(String) : [];
      if (sharers.some((id) => !participantIds.includes(id))) errors[`items.${i}.sharers`] = MESSAGES.sharerNotParticipant;
      else if (sharers.length === 0) errors[`items.${i}.sharers`] = MESSAGES.noSharers;
    });
  }

  if (!base.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  const bill = base.value;
  const items = bill.items.map((item) => ({
    ...item,
    sharerIds: splitMode === 'itemized' ? participantIds.filter((id) => item.sharerIds.includes(id)) : [],
  }));
  return { ok: true, value: { ...bill, items, splitMode, participantIds, payerId: payerId as string } };
}

export interface Totals {
  itemsCents: number;
  taxCents: number;
  otherCents: number;
  tipCents: number;
  totalCents: number;
}

/**
 * Tax and other charges are a % of the items only. A % tip is on the items, or on
 * items + the already-rounded tax. Nothing is ever charged on other charges.
 */
export function computeTotals(bill: Bill): Totals {
  const itemsCents = bill.items.reduce((sum, item) => sum + item.priceCents, 0);
  const taxCents = bill.tax.mode === 'percent' ? percentOf(itemsCents, bill.tax.value) : bill.tax.value;
  const otherCents =
    bill.otherCharges.value === 0
      ? 0
      : bill.otherCharges.mode === 'percent'
        ? percentOf(itemsCents, bill.otherCharges.value)
        : bill.otherCharges.value;
  const tipBase = bill.tipOn === 'items_tax' ? itemsCents + taxCents : itemsCents;
  const tipCents = bill.tip.mode === 'percent' ? percentOf(tipBase, bill.tip.value) : bill.tip.value;
  return { itemsCents, taxCents, otherCents, tipCents, totalCents: itemsCents + taxCents + otherCents + tipCents };
}

export interface Share {
  memberId: string;
  /** Breakdown parts; null for equal splits, where only the total is split. */
  itemsCents: number | null;
  taxCents: number | null;
  otherCents: number | null;
  tipCents: number | null;
  totalCents: number;
  /** Leftover cents this person pays so the shares add up exactly. */
  extraCents: number;
}

/** Equal split: leftover cents go 1 each to the first participants in list order. */
export function splitEqual(totalCents: number, participantIds: string[]): Share[] {
  const n = participantIds.length;
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return participantIds.map((memberId, i) => ({
    memberId,
    itemsCents: null,
    taxCents: null,
    otherCents: null,
    tipCents: null,
    totalCents: base + (i < rest ? 1 : 0),
    extraCents: i < rest ? 1 : 0,
  }));
}

/**
 * Splits `amount` in proportion to `weights` by largest remainder.
 * Ties go to the earlier position. The parts always add up to `amount`.
 */
export function allocateProportional(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (total === 0n) return weights.map(() => 0);
  const big = BigInt(amount);
  const parts = weights.map((w) => (big * BigInt(w)) / total);
  const rems = weights.map((w, i) => ({ i, r: (big * BigInt(w)) % total }));
  let left = Number(big - parts.reduce((s, p) => s + p, 0n));
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rems) {
    if (left <= 0) break;
    parts[i] += 1n;
    left -= 1;
  }
  return parts.map(Number);
}

/**
 * Itemized split: each item is split evenly between the people who shared it
 * (leftover cents to the first of them in list order). Tax, other charges and
 * tip are each split in proportion to each person's items.
 */
export function splitItemized(bill: Bill, totals: Totals, participantIds: string[]): Share[] {
  const index = new Map(participantIds.map((id, i) => [id, i]));
  const items = participantIds.map(() => 0);
  const extra = participantIds.map(() => 0);
  for (const item of bill.items) {
    const sharers = participantIds.filter((id) => item.sharerIds.includes(id));
    const n = sharers.length;
    if (n === 0) continue;
    const base = Math.floor(item.priceCents / n);
    const rest = item.priceCents - base * n;
    sharers.forEach((id, k) => {
      const i = index.get(id) as number;
      items[i] += base + (k < rest ? 1 : 0);
      if (k < rest) extra[i] += 1;
    });
  }
  const tax = allocateProportional(totals.taxCents, items);
  const other = allocateProportional(totals.otherCents, items);
  const tip = allocateProportional(totals.tipCents, items);
  return participantIds.map((memberId, i) => ({
    memberId,
    itemsCents: items[i],
    taxCents: tax[i],
    otherCents: other[i],
    tipCents: tip[i],
    totalCents: items[i] + tax[i] + other[i] + tip[i],
    extraCents: extra[i],
  }));
}

export interface GroupBillResult {
  totals: Totals;
  shares: Share[];
}

export function computeGroupBill(bill: GroupBill): GroupBillResult {
  const totals = computeTotals(bill);
  const shares =
    bill.splitMode === 'itemized'
      ? splitItemized(bill, totals, bill.participantIds)
      : splitEqual(totals.totalCents, bill.participantIds);
  return { totals, shares };
}
