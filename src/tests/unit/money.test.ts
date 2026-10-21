import { describe, expect, it } from 'vitest';
import { formatCents, formatMoney, formatPercent, formatSignedMoney, parseHundredths, percentOf } from '../../shared/money.js';
import { checkCurrency, checkMemberName, checkGroupName, checkPassword, checkUsername, defaultBillName, nameKey, CURRENCIES, MESSAGES } from '../../shared/rules.js';

describe('parseHundredths (typing amounts)', () => {
  it('accepts plain and comma-grouped amounts (US-25 #17)', () => {
    expect(parseHundredths('1000.50')).toBe(100050);
    expect(parseHundredths('1,000.50')).toBe(100050);
    expect(parseHundredths('1,000,000.00')).toBe(100_000_000);
    expect(parseHundredths(' 12.5 ')).toBe(1250);
    expect(parseHundredths('0')).toBe(0);
    expect(parseHundredths('0.01')).toBe(1);
  });

  it.each(['0,500', '000,000', '01,000', '1.000,50', '10,00', 'abc', '-5', '1.234', '', '  ', '12.', '1,00,000', '+5', '1e3', '0x10', 'NaN', 'Infinity'])(
    'rejects %j (US-25 #1, #18)',
    (raw) => {
      expect(parseHundredths(raw)).toBeNull();
    },
  );

  it('treats huge numbers as out of range rather than losing precision', () => {
    expect(parseHundredths('99999999999999999999')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('percentOf rounds half-up to the cent', () => {
  it('matches the docs examples', () => {
    expect(percentOf(3333, 1250)).toBe(417); // 33.33 x 12.5% = 4.16625 -> 4.17 (US-05 #6)
    expect(percentOf(2000, 1250)).toBe(250); // tip 12.5% of 20.00 (US-05 #7)
    expect(percentOf(2000, 825)).toBe(165); // tax 8.25% of 20.00 (US-05 #7)
    expect(percentOf(1, 500)).toBe(0); // 5% of 0.01 (US-05 #8)
    expect(percentOf(10, 5000)).toBe(5);
    expect(percentOf(1, 5000)).toBe(1); // 0.005 -> 0.01 (half-up)
  });
});

describe('formatting (US-26 #8)', () => {
  it('shows thousands commas and 2 decimals', () => {
    expect(formatCents(123456750)).toBe('1,234,567.50');
    expect(formatCents(100_000_000_000)).toBe('1,000,000,000.00');
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
  });

  it('puts the symbol first, with a space for letter symbols', () => {
    expect(formatMoney(123456750, 'Rs')).toBe('Rs 1,234,567.50');
    expect(formatMoney(40000, 'Rs')).toBe('Rs 400.00');
    expect(formatMoney(123456750, '$')).toBe('$1,234,567.50');
    expect(formatMoney(40000, '$')).toBe('$400.00');
    expect(formatMoney(1250, '€')).toBe('€12.50');
    expect(formatMoney(1200, 'CHF')).toBe('CHF 12.00');
    expect(formatMoney(500, 'AED')).toBe('AED 5.00');
    expect(formatMoney(3000, 'kr')).toBe('kr 30.00');
    expect(formatMoney(3000, 'zł')).toBe('zł 30.00');
  });

  it('signs balances with + and a real minus', () => {
    expect(formatSignedMoney(1300, '$')).toBe('+$13.00');
    expect(formatSignedMoney(-1300, '$')).toBe('−$13.00');
    expect(formatSignedMoney(0, '$')).toBe('$0.00');
  });

  it('shows percentages without trailing zeros', () => {
    expect(formatPercent(1250)).toBe('12.5');
    expect(formatPercent(825)).toBe('8.25');
    expect(formatPercent(10000)).toBe('100');
    expect(formatPercent(1)).toBe('0.01');
  });
});

describe('currency symbols (US-06)', () => {
  it('offers exactly the 12 default symbols', () => {
    expect([...CURRENCIES]).toEqual(['$', '€', '£', '¥', '₹', 'Rs', '₩', '₺', 'R$', 'CHF', 'AED', 'SAR']);
  });

  it('accepts 1-3 characters with no digits, trimmed', () => {
    expect(checkCurrency('kr')).toEqual({ ok: true, value: 'kr' });
    expect(checkCurrency('zł')).toEqual({ ok: true, value: 'zł' });
    expect(checkCurrency(' kr ')).toEqual({ ok: true, value: 'kr' });
    expect(checkCurrency('CHF')).toEqual({ ok: true, value: 'CHF' });
  });

  it.each(['', '   ', 'abcd', 'R1', '٣'])('rejects %j with the docs message', (raw) => {
    expect(checkCurrency(raw)).toEqual({ ok: false, message: MESSAGES.currency });
  });
});

describe('names and accounts', () => {
  it('limits group names to 1-50 characters (US-09 #3)', () => {
    expect(checkGroupName('a').ok).toBe(true);
    expect(checkGroupName('a'.repeat(50)).ok).toBe(true);
    expect(checkGroupName('a'.repeat(51)).ok).toBe(false);
    expect(checkGroupName('   ').ok).toBe(false);
  });

  it('limits member names to 1-30 characters and compares them without case (US-10)', () => {
    expect(checkMemberName('a'.repeat(30)).ok).toBe(true);
    expect(checkMemberName('a'.repeat(31)).ok).toBe(false);
    expect(checkMemberName('').ok).toBe(false);
    expect(nameKey('Omar')).toBe(nameKey(' OMAR '));
  });

  it('checks usernames (US-01 #5, #6)', () => {
    expect(checkUsername('abc').ok).toBe(true);
    expect(checkUsername('a'.repeat(30)).ok).toBe(true);
    expect(checkUsername('ab').ok).toBe(false);
    expect(checkUsername('a'.repeat(31)).ok).toBe(false);
    expect(checkUsername('sana!').ok).toBe(false);
    expect(checkUsername('sa na').ok).toBe(false);
    expect(checkUsername('').ok).toBe(false);
  });

  it('checks passwords (US-01 #7, #8)', () => {
    expect(checkPassword('a'.repeat(8)).ok).toBe(true);
    expect(checkPassword('a b c !@'.padEnd(128, 'x')).ok).toBe(true);
    expect(checkPassword('a'.repeat(7)).ok).toBe(false);
    expect(checkPassword('a'.repeat(129)).ok).toBe(false);
    expect(checkPassword('').ok).toBe(false);
  });

  it('names unnamed bills after their date (US-07 #2)', () => {
    expect(defaultBillName('2026-10-21')).toBe('Bill – 21 Oct 2026');
  });
});
