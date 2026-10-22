// The bill form's Calculate step: spare empty item lines are left out, and
// messages about items still point at the right line on the form.
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { addItemTarget, calculate, emptyBill, newItem, rateLabels, stripKeys, toBillInput, toFormErrors, toGroupBillInput } from '../../client/billEditor.js';

const bill = (items: { name: string; price: string }[]) => emptyBill({ items: items.map((it) => newItem(it)) });

describe('US-05 #16 empty item lines', () => {
  it('a line with no name and no price is left out of the total and of what is saved', () => {
    const state = bill([
      { name: 'Coffee', price: '4.50' },
      { name: '', price: '' },
      { name: 'Tea', price: '3.00' },
      { name: '  ', price: ' ' },
    ]);
    const outcome = calculate(state, 'solo', false);
    expect(outcome.ok && outcome.result.totals.itemsCents).toBe(750);
    expect(toBillInput(state).items).toEqual([
      { name: 'Coffee', price: '4.50' },
      { name: 'Tea', price: '3.00' },
    ]);
  });

  it('a message about an item stays next to that item, even after a skipped line', () => {
    const state = bill([
      { name: '', price: '' },
      { name: 'Tea', price: '' },
      { name: '', price: 'abc' },
    ]);
    const outcome = calculate(state, 'solo', false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors).toMatchObject({ 'items.1.price': MESSAGES.price, 'items.2.price': MESSAGES.price });
      expect(outcome.errors).not.toHaveProperty('items.0.price');
    }
  });

  it('only empty lines means no items', () => {
    const outcome = calculate(bill([{ name: '', price: '' }]), 'solo', false);
    expect(!outcome.ok && outcome.errors.items).toBe(MESSAGES.noItems);
  });

  it("the server's item messages are mapped the same way", () => {
    const state = bill([
      { name: '', price: '' },
      { name: 'Tea', price: '3' },
    ]);
    expect(toFormErrors(state, { 'items.0.price': 'x', name: 'y' })).toEqual({ 'items.1.price': 'x', name: 'y' });
  });
});

describe('US-14 #12 and US-26 #10 group lines, sharers and rates', () => {
  const group = (over: Parameters<typeof emptyBill>[0]) =>
    emptyBill({ splitMode: 'itemized', participantIds: ['1', '2'], payerId: '1', ...over });

  it('a message about who shared an item stays next to that item after a skipped line', () => {
    const state = group({
      items: [newItem({ name: '', price: '' }), newItem({ name: 'Naan', price: '3', sharerIds: [] })],
    });
    const outcome = calculate(state, 'group', false);
    expect(!outcome.ok && outcome.errors['items.1.sharers']).toBe(MESSAGES.noSharers);
  });

  it('a line with only people ticked still counts (it needs a price)', () => {
    const state = group({ items: [newItem({ name: '', price: '', sharerIds: ['1'] })] });
    const outcome = calculate(state, 'group', false);
    expect(!outcome.ok && outcome.errors['items.0.price']).toBe(MESSAGES.price);
  });

  it('only people on the bill are sent as sharers; unticked people keep their ticks in the form', () => {
    const state = group({ participantIds: ['1'], items: [newItem({ name: 'Tea', price: '3', sharerIds: ['1', '2'] })] });
    expect(toGroupBillInput(state).items).toEqual([{ name: 'Tea', price: '3', sharerIds: ['1'] }]);
    expect(state.items[0].sharerIds).toEqual(['1', '2']);
  });

  it('empty lines are dropped from what is sent, and a spare line is not an unsaved change', () => {
    const one = group({ items: [newItem({ name: 'Tea', price: '3', sharerIds: ['1'] })] });
    const withSpare = { ...one, items: [...one.items, newItem()] };
    expect(toGroupBillInput(withSpare).items).toHaveLength(1);
    expect(JSON.stringify(stripKeys(withSpare))).toBe(JSON.stringify(stripKeys(one)));
  });

  it('a blank, 0 or 0.00 % shows no rate; other rates do', () => {
    const rates = rateLabels(
      emptyBill({ tax: { mode: 'percent', value: '0' }, otherCharges: { mode: 'percent', value: '0.00' }, tip: { mode: 'percent', value: '15' } }),
    );
    expect(rates).toEqual({ tax: '', other: '', tip: '(15% of items)' });
    expect(rateLabels(emptyBill()).tax).toBe('');
  });
});

describe('US-25 #11 "+ Add item" at the 200-line limit', () => {
  /** A bill with n lines; the lines at the given positions are left empty. */
  const lines = (n: number, empty: number[] = []) =>
    emptyBill({ items: Array.from({ length: n }, (_, i) => newItem(empty.includes(i) ? {} : { name: `Thing ${i + 1}`, price: '1' })) });

  it('adds a new line while the bill has fewer than 200 lines, even with empty ones', () => {
    expect(addItemTarget(lines(199))).toBe('new');
    expect(addItemTarget(lines(199, [3]))).toBe('new');
  });

  it('with 200 lines, goes to the first empty line instead', () => {
    const state = lines(200, [150, 7]);
    expect(addItemTarget(state)).toBe(state.items[7].key);
  });

  it('with 200 lines all in use, there is nowhere to go', () => {
    expect(addItemTarget(lines(200))).toBeNull();
  });

  it('split by items, a line with only people ticked is in use', () => {
    const state = lines(200, [10]);
    const ticked = { ...state, splitMode: 'itemized' as const, participantIds: ['1'] };
    ticked.items = ticked.items.map((item, i) => (i === 10 ? { ...item, sharerIds: ['1'] } : item));
    expect(addItemTarget(ticked)).toBeNull();
    // Someone ticked who isn't on the bill doesn't count.
    expect(addItemTarget({ ...ticked, participantIds: [] })).toBe(ticked.items[10].key);
  });
});
