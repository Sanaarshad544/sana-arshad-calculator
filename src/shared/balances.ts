// Suggested settle-up payments for a group.
//
// Balances themselves are summed by the server: positive = is owed,
// negative = owes. The payer of a bill is credited its grand total and every
// participant is debited their share; a settle-up where A pays B credits A and
// debits B.

export interface Payment {
  fromId: string;
  toId: string;
  amountCents: number;
}

/**
 * Fewest-payments suggestion: repeatedly match the largest debtor with the
 * largest creditor. Ties go to the member listed first.
 */
export function suggestPayments(balances: { memberId: string; cents: number }[]): Payment[] {
  const order = new Map(balances.map((b, i) => [b.memberId, i]));
  const debtors = balances.filter((b) => b.cents < 0).map((b) => ({ id: b.memberId, left: -b.cents }));
  const creditors = balances.filter((b) => b.cents > 0).map((b) => ({ id: b.memberId, left: b.cents }));
  const byLargest = (a: { id: string; left: number }, b: { id: string; left: number }) =>
    b.left - a.left || (order.get(a.id) as number) - (order.get(b.id) as number);
  const payments: Payment[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byLargest);
    creditors.sort(byLargest);
    const d = debtors[0];
    const c = creditors[0];
    const amountCents = Math.min(d.left, c.left);
    payments.push({ fromId: d.id, toId: c.id, amountCents });
    d.left -= amountCents;
    c.left -= amountCents;
    if (d.left === 0) debtors.shift();
    if (c.left === 0) creditors.shift();
  }
  return payments;
}
