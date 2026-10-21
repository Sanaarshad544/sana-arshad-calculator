import { describe, expect, it } from 'vitest';
import {
  allocateProportional,
  checkBill,
  checkGroupBill,
  computeGroupBill,
  computeTotals,
  type BillInput,
  type ChargeInput,
  type GroupBillInput,
  type Totals,
} from '../../shared/bill.js';
import { suggestPayments } from '../../shared/balances.js';
import { MESSAGES } from '../../shared/rules.js';

const pct = (value: string): ChargeInput => ({ mode: 'percent', value });
const amt = (value: string): ChargeInput => ({ mode: 'amount', value });

function bill(over: Partial<BillInput> & { prices?: string[] } = {}): BillInput {
  const { prices = ['10.00'], ...rest } = over;
  return {
    name: '',
    items: prices.map((price) => ({ name: '', price })),
    tax: amt('0'),
    otherCharges: amt(''),
    tip: amt('0'),
    tipOn: 'items',
    ...rest,
  };
}

function totals(input: BillInput): Totals {
  const checked = checkBill(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return computeTotals(checked.value);
}

function errors(input: BillInput): Record<string, string> {
  const checked = checkBill(input);
  if (checked.ok) throw new Error('expected errors');
  return checked.errors;
}

const T = (items: number, tax: number, other: number, tip: number) => ({
  itemsCents: items,
  taxCents: tax,
  otherCents: other,
  tipCents: tip,
  totalCents: items + tax + other + tip,
});

describe('solo bill totals (US-05)', () => {
  it('#1 subtotal 20.00, tax 2.00, other 0.00, tip 3.00, total 25.00', () => {
    expect(totals(bill({ prices: ['12.50', '7.50'], tax: pct('10'), tip: pct('15') }))).toEqual(T(2000, 200, 0, 300));
  });
  it('#2 other charges 5% gives 1.00 and total 26.00', () => {
    const t = totals(bill({ prices: ['12.50', '7.50'], tax: pct('10'), otherCharges: pct('5'), tip: pct('15') }));
    expect(t).toEqual(T(2000, 200, 100, 300));
    expect(t.totalCents).toBe(2600);
  });
  it('#3 tip 15% on items + tax is 16.50, total 126.50', () => {
    const t = totals(bill({ prices: ['100.00'], tax: amt('10.00'), tip: pct('15'), tipOn: 'items_tax' }));
    expect(t.tipCents).toBe(1650);
    expect(t.totalCents).toBe(12650);
  });
  it('#4 other charges are not tipped on: total 134.00', () => {
    const t = totals(bill({ prices: ['100.00'], tax: amt('10.00'), otherCharges: amt('7.50'), tip: pct('15'), tipOn: 'items_tax' }));
    expect(t).toEqual(T(10000, 1000, 750, 1650));
    expect(t.totalCents).toBe(13400);
  });
  it('#5 other charges % is of items only', () => {
    expect(totals(bill({ prices: ['100.00'], tax: pct('10'), otherCharges: pct('10') })).otherCents).toBe(1000);
  });
  it('#6 12.5% of 33.33 rounds half-up to 4.17', () => {
    expect(totals(bill({ prices: ['33.33'], otherCharges: pct('12.5') })).otherCents).toBe(417);
  });
  it('#7 tip 12.5% of 20.00 is 2.50 and tax 8.25% of 20.00 is 1.65', () => {
    expect(totals(bill({ prices: ['20.00'], tip: pct('12.5') })).tipCents).toBe(250);
    expect(totals(bill({ prices: ['20.00'], tax: pct('8.25') })).taxCents).toBe(165);
  });
  it('#8 5% of 0.01 rounds to 0.00 with no error', () => {
    expect(totals(bill({ prices: ['0.01'], otherCharges: pct('5') })).otherCents).toBe(0);
  });
  it('#9 other charges 0 or 0.00 means none', () => {
    expect(totals(bill({ otherCharges: amt('0') })).otherCents).toBe(0);
    expect(totals(bill({ otherCharges: amt('0.00') })).otherCents).toBe(0);
    expect(totals(bill({ otherCharges: pct('0') })).otherCents).toBe(0);
  });
  it('#10 tip 0 shows 0.00', () => {
    expect(totals(bill({ tip: amt('0') })).tipCents).toBe(0);
    expect(totals(bill({ tip: pct('0') })).tipCents).toBe(0);
  });
  it('#12 other charges 1,000,000.00 on items 0.01 gives 1,000,000.01', () => {
    const t = totals(bill({ prices: ['0.01'], otherCharges: amt('1,000,000.00') }));
    expect(t.otherCents).toBe(100_000_000);
    expect(t.totalCents).toBe(100_000_001);
  });
  it('#13 no items: "Add at least one item"', () => {
    expect(errors(bill({ prices: [] })).items).toBe(MESSAGES.noItems);
  });
});

describe('input checks (US-25)', () => {
  it.each(['abc', '-5', '1.234', '1000000.01', ''])('#1 rejects item price %j', (price) => {
    expect(errors(bill({ prices: [price] }))['items.0.price']).toBe(MESSAGES.price);
  });
  it('#2 accepts 0.01 and 1,000,000.00 prices', () => {
    expect(totals(bill({ prices: ['0.01', '1000000.00'] })).itemsCents).toBe(100_000_001);
  });
  it('rejects a 0 price', () => {
    expect(errors(bill({ prices: ['0'] }))['items.0.price']).toBe(MESSAGES.price);
  });
  it('#3 rejects tax/tip % outside 0-100', () => {
    expect(errors(bill({ tax: pct('-1') })).tax).toBe(MESSAGES.taxPercent);
    expect(errors(bill({ tip: pct('100.01') })).tip).toBe(MESSAGES.tipPercent);
  });
  it('#4 accepts tax/tip % of exactly 0 and 100', () => {
    expect(totals(bill({ tax: pct('0'), tip: pct('100') })).tipCents).toBe(1000);
    expect(totals(bill({ tax: pct('100') })).taxCents).toBe(1000);
  });
  it('#5 rejects 3 decimals in a %', () => {
    expect(errors(bill({ tax: pct('12.345') })).tax).toBe(MESSAGES.taxPercent);
  });
  it('#6 rejects bad tax/tip amounts', () => {
    expect(errors(bill({ tax: amt('1000000.01') })).tax).toBe(MESSAGES.taxAmount);
    expect(errors(bill({ tip: amt('abc') })).tip).toBe(MESSAGES.tipAmount);
    expect(errors(bill({ tip: amt('1.234') })).tip).toBe(MESSAGES.tipAmount);
    expect(errors(bill({ tax: amt('') })).tax).toBe(MESSAGES.taxAmount);
  });
  it.each(['abc', '-1', '0.001', '1000000.01'])('#7 rejects other charges amount %j', (value) => {
    expect(errors(bill({ otherCharges: amt(value) })).otherCharges).toBe(
      'Other charges must be between 0.01 and 1,000,000.00, or left empty',
    );
  });
  it.each(['abc', '-5', '0.001', '100.01'])('#8 rejects other charges %% %j', (value) => {
    expect(errors(bill({ otherCharges: pct(value) })).otherCharges).toBe(
      'Other charges must be between 0.01% and 100%, or left empty',
    );
  });
  it('#9 accepts other charges at the limits', () => {
    expect(totals(bill({ otherCharges: amt('0.01') })).otherCents).toBe(1);
    expect(totals(bill({ otherCharges: amt('1000000.00') })).otherCents).toBe(100_000_000);
    expect(totals(bill({ prices: ['100.00'], otherCharges: pct('0.01') })).otherCents).toBe(1);
    expect(totals(bill({ otherCharges: pct('100') })).otherCents).toBe(1000);
  });
  it('#11 allows 200 items but not 201', () => {
    expect(totals(bill({ prices: Array(200).fill('1.00') })).itemsCents).toBe(20000);
    expect(errors(bill({ prices: Array(201).fill('1.00') })).items).toBe(MESSAGES.tooManyItems);
  });
  it('#12 the 1,000,000.00 limit is per field: 3 x 1M gives 3,000,000.00', () => {
    expect(totals(bill({ prices: Array(3).fill('1000000.00') })).itemsCents).toBe(300_000_000);
  });
  it('#13 the largest bill is exactly 1,000,000,000.00', () => {
    const t = totals(
      bill({ prices: Array(200).fill('1000000.00'), tax: pct('100'), otherCharges: pct('100'), tip: pct('100'), tipOn: 'items_tax' }),
    );
    expect(t).toEqual(T(20_000_000_000, 20_000_000_000, 20_000_000_000, 40_000_000_000));
    expect(t.totalCents).toBe(100_000_000_000);
  });
  it('#14 item names up to 40 characters; bill names up to 60', () => {
    expect(checkBill({ ...bill(), items: [{ name: 'x'.repeat(40), price: '1' }] }).ok).toBe(true);
    expect(errors({ ...bill(), items: [{ name: 'x'.repeat(41), price: '1' }] })['items.0.name']).toBe(MESSAGES.itemName);
    expect(checkBill(bill({ name: 'x'.repeat(60) })).ok).toBe(true);
    expect(errors(bill({ name: 'x'.repeat(61) })).name).toBe(MESSAGES.billName);
  });
  it('#15 never produces NaN or Infinity for odd input', () => {
    for (const raw of ['NaN', 'Infinity', '1e309', '', '9'.repeat(400)]) {
      const checked = checkBill(bill({ prices: [raw], tax: pct(raw), tip: amt(raw) }));
      expect(checked.ok).toBe(false);
    }
  });
  it('#17/#18 commas: 1,000.50 ok, 1.000,50 and 10,00 rejected', () => {
    expect(totals(bill({ prices: ['1,000.50'] })).itemsCents).toBe(100050);
    expect(errors(bill({ prices: ['1.000,50'] }))['items.0.price']).toBe(MESSAGES.price);
    expect(errors(bill({ prices: ['10,00'] }))['items.0.price']).toBe(MESSAGES.price);
  });
});

// ---------- Group bills ----------

const [ALI, SARA, OMAR] = ['1', '2', '3'];

function groupBill(over: Partial<GroupBillInput> & { prices?: string[] } = {}): GroupBillInput {
  const { prices, ...rest } = over;
  return { ...bill({ prices }), splitMode: 'equal', participantIds: [ALI, SARA, OMAR], payerId: ALI, ...rest };
}

function compute(input: GroupBillInput) {
  const checked = checkGroupBill(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const result = computeGroupBill(checked.value);
  const sum = result.shares.reduce((s, x) => s + x.totalCents, 0);
  expect(sum).toBe(result.totals.totalCents); // invariant: shares add up exactly
  return result;
}

function groupErrors(input: GroupBillInput) {
  const checked = checkGroupBill(input);
  if (checked.ok) throw new Error('expected errors');
  return checked.errors;
}

describe('equal split (US-13)', () => {
  it('#2 100.00 between 3: 33.34 / 33.33 / 33.33, first pays the extra cent', () => {
    const r = compute(groupBill({ prices: ['100.00'] }));
    expect(r.shares.map((s) => s.totalCents)).toEqual([3334, 3333, 3333]);
    expect(r.shares.map((s) => s.extraCents)).toEqual([1, 0, 0]);
  });
  it('#3 other charges 10% of 90.00 = 9.00, total 99.00, 33.00 each', () => {
    const r = compute(groupBill({ prices: ['90.00'], otherCharges: pct('10') }));
    expect(r.totals.otherCents).toBe(900);
    expect(r.totals.totalCents).toBe(9900);
    expect(r.shares.map((s) => s.totalCents)).toEqual([3300, 3300, 3300]);
  });
  it('#4 10.00 + 0.01 other charges between 2: 5.01 / 5.00', () => {
    const r = compute(groupBill({ prices: ['10.00'], otherCharges: amt('0.01'), participantIds: [ALI, SARA] }));
    expect(r.totals.totalCents).toBe(1001);
    expect(r.shares.map((s) => s.totalCents)).toEqual([501, 500]);
  });
  it('#5 0.01 between 2: 0.01 / 0.00', () => {
    const r = compute(groupBill({ prices: ['0.01'], participantIds: [ALI, SARA] }));
    expect(r.shares.map((s) => s.totalCents)).toEqual([1, 0]);
  });
  it('#6 1M items with 100% tip between 50: 40,000.00 each', () => {
    const ids = Array.from({ length: 50 }, (_, i) => String(i + 1));
    const r = compute(groupBill({ prices: ['1000000.00'], tip: pct('100'), participantIds: ids, payerId: '1' }));
    expect(r.totals.totalCents).toBe(200_000_000);
    expect(new Set(r.shares.map((s) => s.totalCents))).toEqual(new Set([4_000_000]));
  });
  it('#7 1M items + 1M other charges between 3: 666,666.67 / 666,666.67 / 666,666.66', () => {
    const r = compute(groupBill({ prices: ['1000000.00'], otherCharges: amt('1000000.00') }));
    expect(r.totals.totalCents).toBe(200_000_000);
    expect(r.shares.map((s) => s.totalCents)).toEqual([66_666_667, 66_666_667, 66_666_666]);
  });
  it('#8 no participants: "Choose who took part"', () => {
    expect(groupErrors(groupBill({ participantIds: [], payerId: null })).participants).toBe(MESSAGES.noParticipants);
  });
  it('#9 no items: "Add at least one item"', () => {
    expect(groupErrors(groupBill({ prices: [] })).items).toBe(MESSAGES.noItems);
  });
});

describe('itemized split (US-14)', () => {
  const itemized = (items: { price: string; sharers: string[] }[], over: Partial<GroupBillInput> = {}) =>
    groupBill({
      splitMode: 'itemized',
      participantIds: [ALI, SARA],
      ...over,
      items: items.map((it) => ({ name: '', price: it.price, sharerIds: it.sharers })),
    });

  it('#1 steak 40.00 + salad 10.00, tax 5.00, tip 10.00: Ali 52.00, Sara 13.00', () => {
    const r = compute(itemized([{ price: '40.00', sharers: [ALI] }, { price: '10.00', sharers: [SARA] }], { tax: amt('5.00'), tip: amt('10.00') }));
    expect(r.shares.map((s) => s.totalCents)).toEqual([5200, 1300]);
  });
  it('#2 with other charges 2.50: Ali 2.00 / Sara 0.50, totals 54.00 / 13.50 = 67.50', () => {
    const r = compute(
      itemized([{ price: '40.00', sharers: [ALI] }, { price: '10.00', sharers: [SARA] }], {
        tax: amt('5.00'),
        tip: amt('10.00'),
        otherCharges: amt('2.50'),
      }),
    );
    expect(r.shares.map((s) => s.otherCents)).toEqual([200, 50]);
    expect(r.shares.map((s) => s.totalCents)).toEqual([5400, 1350]);
    expect(r.totals.totalCents).toBe(6750);
  });
  it('#3 nachos 12.00 shared by 3: 4.00 each', () => {
    const r = compute(itemized([{ price: '12.00', sharers: [ALI, SARA, OMAR] }], { participantIds: [ALI, SARA, OMAR] }));
    expect(r.shares.map((s) => s.itemsCents)).toEqual([400, 400, 400]);
  });
  it('#4 10.00 shared by 3: 3.34 / 3.33 / 3.33, extra cent to the first ticked', () => {
    const r = compute(itemized([{ price: '10.00', sharers: [OMAR, SARA, ALI] }], { participantIds: [ALI, SARA, OMAR] }));
    expect(r.shares.map((s) => s.itemsCents)).toEqual([334, 333, 333]);
    expect(r.shares.map((s) => s.extraCents)).toEqual([1, 0, 0]);
  });
  it('#5 equal items, other charges 0.10: 0.04 / 0.03 / 0.03', () => {
    const r = compute(
      itemized(
        [
          { price: '10.00', sharers: [ALI] },
          { price: '10.00', sharers: [SARA] },
          { price: '10.00', sharers: [OMAR] },
        ],
        { participantIds: [ALI, SARA, OMAR], otherCharges: amt('0.10') },
      ),
    );
    expect(r.shares.map((s) => s.otherCents)).toEqual([4, 3, 3]);
  });
  it('#6 tax, other charges and tip parts each add up exactly', () => {
    const r = compute(
      itemized(
        [
          { price: '7.77', sharers: [ALI] },
          { price: '3.33', sharers: [SARA, OMAR] },
          { price: '9.99', sharers: [ALI, OMAR] },
        ],
        { participantIds: [ALI, SARA, OMAR], tax: pct('8.25'), otherCharges: pct('3.33'), tip: pct('17.5'), tipOn: 'items_tax' },
      ),
    );
    const sum = (k: 'taxCents' | 'otherCents' | 'tipCents' | 'itemsCents') => r.shares.reduce((s, x) => s + (x[k] ?? 0), 0);
    expect(sum('itemsCents')).toBe(r.totals.itemsCents);
    expect(sum('taxCents')).toBe(r.totals.taxCents);
    expect(sum('otherCents')).toBe(r.totals.otherCents);
    expect(sum('tipCents')).toBe(r.totals.tipCents);
  });
  it('#7 someone with no items owes 0.00', () => {
    const r = compute(itemized([{ price: '20.00', sharers: [ALI] }], { participantIds: [ALI, SARA], otherCharges: amt('5.00'), tax: pct('10'), tip: pct('10') }));
    expect(r.shares[1]).toMatchObject({ itemsCents: 0, taxCents: 0, otherCents: 0, tipCents: 0, totalCents: 0 });
  });
  it('#8 an item with nobody ticked: "Choose who shared this item"', () => {
    expect(groupErrors(itemized([{ price: '20.00', sharers: [] }]))['items.0.sharers']).toBe(MESSAGES.noSharers);
  });
  it('rejects sharers who are not on the bill', () => {
    expect(groupErrors(itemized([{ price: '20.00', sharers: [OMAR] }]))['items.0.sharers']).toBe(MESSAGES.sharerNotParticipant);
  });
  it('#9 largest itemized bill still adds up', () => {
    const ids = Array.from({ length: 50 }, (_, i) => String(i + 1));
    const items = Array.from({ length: 200 }, (_, i) => ({ price: '999999.99', sharers: ids.slice(0, (i % 50) + 1) }));
    compute(itemized(items, { participantIds: ids, payerId: '1', tax: pct('99.99'), otherCharges: pct('77.77'), tip: pct('100'), tipOn: 'items_tax' }));
  });
});

describe('payer (US-15)', () => {
  it('#2 the payer must be on the bill', () => {
    expect(groupErrors(groupBill({ participantIds: [ALI, SARA], payerId: OMAR })).payer).toBe(MESSAGES.payerNotParticipant);
  });
  it('asks for a payer when none is chosen', () => {
    expect(groupErrors(groupBill({ payerId: null })).payer).toBe(MESSAGES.noPayer);
  });
});

describe('largest remainder allocation', () => {
  it('always adds up and gives ties to the earlier position', () => {
    expect(allocateProportional(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocateProportional(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportional(100, [0, 0])).toEqual([0, 0]);
    const parts = allocateProportional(40_000_000_000, [19_999_999_999, 1, 7]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(40_000_000_000);
  });
});

describe('suggested payments (US-16)', () => {
  it('#1 Sara pays Ali 13.00', () => {
    expect(suggestPayments([{ memberId: ALI, cents: 1300 }, { memberId: SARA, cents: -1300 }])).toEqual([
      { fromId: SARA, toId: ALI, amountCents: 1300 },
    ]);
  });
  it('#3 largest debtor pays largest creditor first, fewest payments', () => {
    const p = suggestPayments([
      { memberId: 'a', cents: 5000 },
      { memberId: 'b', cents: 1000 },
      { memberId: 'c', cents: -4000 },
      { memberId: 'd', cents: -2000 },
    ]);
    expect(p).toEqual([
      { fromId: 'c', toId: 'a', amountCents: 4000 },
      { fromId: 'd', toId: 'a', amountCents: 1000 },
      { fromId: 'd', toId: 'b', amountCents: 1000 },
    ]);
  });
  it('#4 no suggestions when everyone is at 0.00', () => {
    expect(suggestPayments([{ memberId: 'a', cents: 0 }, { memberId: 'b', cents: 0 }])).toEqual([]);
  });
  it('US-17 #2 overpaying flips the debt: Ali pays Sara 7.00', () => {
    // Sara owed 13.00 and paid 20.00: Sara +7.00, Ali -7.00.
    expect(suggestPayments([{ memberId: ALI, cents: -700 }, { memberId: SARA, cents: 700 }])).toEqual([
      { fromId: ALI, toId: SARA, amountCents: 700 },
    ]);
  });
});
