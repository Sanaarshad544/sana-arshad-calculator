// Converting between checked bills and database rows.

import type { Bill, BillInput, Charge, ChargeInput, TipOn, Totals } from '../shared/bill.js';
import { centsToInput, formatPercent } from '../shared/money.js';

export interface ChargeColumns {
  tax_mode: string;
  tax_value: number;
  other_mode: string;
  other_value: number;
  tip_mode: string;
  tip_value: number;
  tip_on: string;
}

export interface TotalsColumns {
  items_cents: number;
  tax_cents: number;
  other_cents: number;
  tip_cents: number;
  total_cents: number;
}

/** Column values for a bill's tax/other charges/tip settings, in a fixed order. */
export function chargeValues(bill: Bill): (string | number)[] {
  return [
    bill.tax.mode,
    bill.tax.value,
    bill.otherCharges.mode,
    bill.otherCharges.value,
    bill.tip.mode,
    bill.tip.value,
    bill.tipOn,
  ];
}

export function totalsValues(t: Totals): number[] {
  return [t.itemsCents, t.taxCents, t.otherCents, t.tipCents, t.totalCents];
}

export function rowTotals(row: TotalsColumns): Totals {
  return {
    itemsCents: row.items_cents,
    taxCents: row.tax_cents,
    otherCents: row.other_cents,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
  };
}

function chargeToInput(charge: Charge, blankWhenZero: boolean): ChargeInput {
  if (blankWhenZero && charge.value === 0) return { mode: charge.mode, value: '' };
  return { mode: charge.mode, value: charge.mode === 'percent' ? formatPercent(charge.value) : centsToInput(charge.value) };
}

/** Rebuilds the form values exactly as they were saved. */
export function rowToInput(
  row: ChargeColumns & { name: string },
  items: { name: string; price_cents: number; sharer_ids?: number[] }[],
): BillInput {
  return {
    name: row.name,
    items: items.map((it) => ({
      name: it.name,
      price: centsToInput(it.price_cents),
      sharerIds: (it.sharer_ids ?? []).map(String),
    })),
    tax: chargeToInput({ mode: row.tax_mode as Charge['mode'], value: row.tax_value }, false),
    otherCharges: chargeToInput({ mode: row.other_mode as Charge['mode'], value: row.other_value }, true),
    tip: chargeToInput({ mode: row.tip_mode as Charge['mode'], value: row.tip_value }, false),
    tipOn: row.tip_on as TipOn,
  };
}

/** Today's date (server time) as YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** DATE columns come back as "YYYY-MM-DD" text (see db.ts). */
export function dateString(value: string): string {
  return value.slice(0, 10);
}
