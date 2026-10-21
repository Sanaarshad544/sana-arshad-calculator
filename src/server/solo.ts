import { Router } from 'express';
import { checkBill, computeTotals, type BillInput } from '../shared/bill.js';
import { checkCurrency, defaultBillName } from '../shared/rules.js';
import type { SoloBillDetail, SoloBillSummary } from '../shared/api.js';
import { currentAccount, requireAuth } from './auth.js';
import { transaction, type Pool } from './db.js';
import { HttpError, fieldError } from './http.js';
import { chargeValues, dateString, rowToInput, rowTotals, today, totalsValues, type ChargeColumns, type TotalsColumns } from './billRows.js';

interface SoloRow extends ChargeColumns, TotalsColumns {
  id: number;
  name: string;
  bill_date: string;
  currency: string;
}

const summary = (row: SoloRow): SoloBillSummary => ({
  id: String(row.id),
  name: row.name,
  date: dateString(row.bill_date),
  currency: row.currency,
  totalCents: row.total_cents,
});

/** A bill id from the URL; anything else is "not found". */
export function parseId(raw: string | undefined): number {
  if (!raw || !/^\d{1,15}$/.test(raw)) throw new HttpError(404, 'Not found');
  return Number(raw);
}

const NOT_FOUND = 'That bill could not be found';

export function soloRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (_req, res) => {
    const account = currentAccount(res);
    const { rows } = await pool.query<SoloRow>(
      'SELECT * FROM solo_bills WHERE account_id = $1 ORDER BY created_at DESC, id DESC',
      [account.id],
    );
    res.json({ bills: rows.map(summary) });
  });

  router.get('/:id', async (req, res) => {
    const account = currentAccount(res);
    const id = parseId(req.params.id);
    const { rows } = await pool.query<SoloRow>('SELECT * FROM solo_bills WHERE id = $1 AND account_id = $2', [id, account.id]);
    if (!rows[0]) throw new HttpError(404, NOT_FOUND);
    const items = await pool.query('SELECT name, price_cents FROM solo_bill_items WHERE bill_id = $1 ORDER BY position', [id]);
    const detail: SoloBillDetail = { ...summary(rows[0]), input: rowToInput(rows[0], items.rows), totals: rowTotals(rows[0]) };
    res.json({ bill: detail });
  });

  router.post('/', async (req, res) => {
    const account = currentAccount(res);
    const currency = checkCurrency(String(req.body?.currency ?? ''));
    const checked = checkBill((req.body?.bill ?? {}) as BillInput);
    const errors = checked.ok ? {} : { ...checked.errors };
    if (!currency.ok) errors.currency = currency.message;
    if (!checked.ok || !currency.ok) throw fieldError(errors);
    const bill = checked.value;
    const totals = computeTotals(bill);
    const date = today();
    const name = bill.name || defaultBillName(date);

    const row = await transaction(pool, async (client) => {
      const { rows } = await client.query<SoloRow>(
        `INSERT INTO solo_bills (account_id, name, bill_date, currency,
           tax_mode, tax_value, other_mode, other_value, tip_mode, tip_value, tip_on,
           items_cents, tax_cents, other_cents, tip_cents, total_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [account.id, name, date, currency.value, ...chargeValues(bill), ...totalsValues(totals)],
      );
      await insertItems(client, rows[0].id, bill.items);
      return rows[0];
    });
    res.status(201).json({ bill: summary(row) });
  });

  router.put('/:id', async (req, res) => {
    const account = currentAccount(res);
    const id = parseId(req.params.id);
    const checked = checkBill((req.body?.bill ?? {}) as BillInput);
    if (!checked.ok) throw fieldError(checked.errors);
    const bill = checked.value;
    const totals = computeTotals(bill);

    const row = await transaction(pool, async (client) => {
      const existing = await client.query<SoloRow>(
        'SELECT * FROM solo_bills WHERE id = $1 AND account_id = $2 FOR UPDATE',
        [id, account.id],
      );
      if (!existing.rows[0]) throw new HttpError(404, NOT_FOUND);
      const name = bill.name || defaultBillName(dateString(existing.rows[0].bill_date));
      // The currency is never changed here: it was locked at the first save.
      const { rows } = await client.query<SoloRow>(
        `UPDATE solo_bills SET name = $2,
           tax_mode = $3, tax_value = $4, other_mode = $5, other_value = $6, tip_mode = $7, tip_value = $8, tip_on = $9,
           items_cents = $10, tax_cents = $11, other_cents = $12, tip_cents = $13, total_cents = $14, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, name, ...chargeValues(bill), ...totalsValues(totals)],
      );
      await client.query('DELETE FROM solo_bill_items WHERE bill_id = $1', [id]);
      await insertItems(client, id, bill.items);
      return rows[0];
    });
    res.json({ bill: summary(row) });
  });

  router.delete('/:id', async (req, res) => {
    const account = currentAccount(res);
    const id = parseId(req.params.id);
    const result = await pool.query('DELETE FROM solo_bills WHERE id = $1 AND account_id = $2', [id, account.id]);
    if (result.rowCount !== 1) throw new HttpError(404, NOT_FOUND);
    res.json({ ok: true });
  });

  return router;
}

async function insertItems(
  client: { query: Pool['query'] },
  billId: number,
  items: { name: string; priceCents: number }[],
): Promise<void> {
  if (items.length === 0) return;
  await client.query(
    `INSERT INTO solo_bill_items (bill_id, position, name, price_cents)
     SELECT $1, p, n, c FROM unnest($2::int[], $3::text[], $4::bigint[]) AS t(p, n, c)`,
    [billId, items.map((_, i) => i), items.map((it) => it.name), items.map((it) => it.priceCents)],
  );
}
