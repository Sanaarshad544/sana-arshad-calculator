// Whole-cent money helpers. Amounts are always integers (cents, or hundredths
// of a percent for percentages). Never use floating-point for money.

/** 1,000,000.00 in cents: the limit for any single money field. */
export const MAX_FIELD_CENTS = 100_000_000;
/** 100% in hundredths of a percent (basis points). */
export const MAX_PERCENT_BP = 10_000;

const PLAIN = /^\d+(\.\d{1,2})?$/;
// A thousands group never starts with 0: "0,500" is refused, not read as 500.
const GROUPED = /^[1-9]\d{0,2}(,\d{3})+(\.\d{1,2})?$/;
// Integer parts longer than this are far above any limit, so we stop there.
const MAX_INT_DIGITS = 13;

/**
 * Parses a non-negative decimal with at most 2 decimal places into hundredths.
 * Accepts "1000.50" and "1,000.50" (correct thousands commas only).
 * Returns null for anything else: blanks, letters, signs, 3+ decimals,
 * European style "1.000,50" or misplaced commas like "10,00".
 * Returns Infinity for numbers too long to matter, so range checks reject them.
 */
export function parseHundredths(raw: string): number | null {
  const text = raw.trim();
  if (!PLAIN.test(text) && !GROUPED.test(text)) return null;
  const [intPart, fracPart = ''] = text.replace(/,/g, '').split('.');
  const digits = intPart.replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_INT_DIGITS) return Number.POSITIVE_INFINITY;
  return Number(digits) * 100 + Number(fracPart.padEnd(2, '0'));
}


/** Rounds n / d half-up for non-negative integers, exactly. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/** basisPoints% of baseCents, rounded half-up to the cent. */
export function percentOf(baseCents: number, basisPoints: number): number {
  return Number(divRoundHalfUp(BigInt(baseCents) * BigInt(basisPoints), 10_000n));
}

/** Formats cents (any sign) as "1,234,567.50" without a sign. */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

/** Formats basis points as a percent string without trailing zeros: 1250 -> "12.5". */
export function formatPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Cents as an editable input string: 100050 -> "1000.50". */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const LETTER = /\p{L}/u;

/**
 * Formats an amount with its currency symbol before it: "$12.50", "€12.50".
 * Symbols containing letters get a space: "Rs 400.00", "CHF 12.00", "kr 30.00".
 * Negative amounts get a real minus sign: "−$13.00".
 */
export function formatMoney(cents: number, symbol: string): string {
  const sep = LETTER.test(symbol) ? ' ' : '';
  const sign = cents < 0 ? '−' : '';
  return `${sign}${symbol}${sep}${formatCents(cents)}`;
}

/** "+$13.00" / "−$13.00" / "$0.00" for balances. */
export function formatSignedMoney(cents: number, symbol: string): string {
  if (cents > 0) return `+${formatMoney(cents, symbol)}`;
  return formatMoney(cents, symbol);
}
