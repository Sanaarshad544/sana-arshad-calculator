import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { amt, newUser, pct, soloBill, testApp } from './helpers.js';

describe('US-05/US-07 save a solo bill', () => {
  it('saves with server-calculated totals, newest first, default name', async () => {
    const { agent } = await newUser();
    const first = await agent.post('/api/solo-bills').send({ currency: '€', bill: soloBill(['12.50', '7.50'], { tax: pct('10'), otherCharges: pct('5'), tip: pct('15') }) });
    expect(first.status).toBe(201);
    expect(first.body.bill).toMatchObject({ currency: '€', totalCents: 2600 });
    expect(first.body.bill.name).toMatch(/^Bill – \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    const second = await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['1.00'], { name: 'Coffee' }) });
    const list = await agent.get('/api/solo-bills');
    expect(list.body.bills.map((b: { id: string }) => b.id)).toEqual([second.body.bill.id, first.body.bill.id]);
  });

  it('ignores any totals the page sends and recalculates', async () => {
    const { agent } = await newUser();
    const res = await agent.post('/api/solo-bills').send({ currency: '$', bill: { ...soloBill(['10.00']), totalCents: 1 } });
    expect(res.body.bill.totalCents).toBe(1000);
  });

  it('#3 bill names up to 60 characters', async () => {
    const { agent } = await newUser();
    expect((await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['1'], { name: 'x'.repeat(60) }) })).status).toBe(201);
    const long = await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['1'], { name: 'x'.repeat(61) }) });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.name).toBe(MESSAGES.billName);
  });

  it('US-25 #16 invalid data sent straight to the server saves nothing', async () => {
    const { agent } = await newUser();
    const bad = [
      { currency: '$', bill: soloBill([]) },
      { currency: '$', bill: soloBill(['-5']) },
      { currency: '$', bill: soloBill(['1'], { tax: pct('100.01') }) },
      { currency: '$', bill: soloBill(['1'], { otherCharges: amt('0.001') }) },
      { currency: '$', bill: soloBill(Array(201).fill('1')) },
      { currency: '$', bill: 'nonsense' },
      { currency: '$' },
      {},
    ];
    for (const body of bad) expect((await agent.post('/api/solo-bills').send(body)).status).toBe(400);
    expect((await agent.get('/api/solo-bills')).body.bills).toEqual([]);
  });

  it('US-25 #13 the largest bill is saved exactly', async () => {
    const { agent } = await newUser();
    const res = await agent.post('/api/solo-bills').send({
      currency: '$',
      bill: soloBill(Array(200).fill('1,000,000.00'), { tax: pct('100'), otherCharges: pct('100'), tip: pct('100'), tipOn: 'items_tax' }),
    });
    expect(res.status).toBe(201);
    const detail = await agent.get(`/api/solo-bills/${res.body.bill.id}`);
    expect(detail.body.bill.totals).toEqual({
      itemsCents: 20_000_000_000,
      taxCents: 20_000_000_000,
      otherCents: 20_000_000_000,
      tipCents: 40_000_000_000,
      totalCents: 100_000_000_000,
    });
  });
});

describe('US-06 currency', () => {
  it('#4/#8 rejects bad symbols sent straight to the server', async () => {
    const { agent } = await newUser();
    for (const currency of ['', 'abcd', 'R1']) {
      const res = await agent.post('/api/solo-bills').send({ currency, bill: soloBill(['1']) });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.currency).toBe(MESSAGES.currency);
    }
  });

  it('#5 trims spaces', async () => {
    const { agent } = await newUser();
    const res = await agent.post('/api/solo-bills').send({ currency: ' kr ', bill: soloBill(['1']) });
    expect(res.body.bill.currency).toBe('kr');
  });

  it('#7 the currency is locked after the first save', async () => {
    const { agent } = await newUser();
    const created = await agent.post('/api/solo-bills').send({ currency: '£', bill: soloBill(['1']) });
    const id = created.body.bill.id;
    const edit = await agent.put(`/api/solo-bills/${id}`).send({ currency: '$', bill: soloBill(['2']) });
    expect(edit.status).toBe(200);
    expect(edit.body.bill.currency).toBe('£');
  });
});

describe('US-08 open, edit and delete', () => {
  it('#1 reopens every input exactly as saved', async () => {
    const { agent } = await newUser();
    const bill = soloBill(['33.33', '1,000.50'], { name: 'Lunch', tax: pct('8.25'), otherCharges: amt('7.50'), tip: pct('12.5'), tipOn: 'items_tax' });
    bill.items = [
      { name: 'Soup', price: '33.33' },
      { name: '', price: '1,000.50' },
    ];
    const created = await agent.post('/api/solo-bills').send({ currency: 'Rs', bill });
    const detail = (await agent.get(`/api/solo-bills/${created.body.bill.id}`)).body.bill;
    expect(detail.input).toEqual({
      name: 'Lunch',
      items: [
        { name: 'Soup', price: '33.33', sharerIds: [] },
        { name: '', price: '1000.50', sharerIds: [] },
      ],
      tax: { mode: 'percent', value: '8.25' },
      otherCharges: { mode: 'amount', value: '7.50' },
      tip: { mode: 'percent', value: '12.5' },
      tipOn: 'items_tax',
    });
    expect(detail.currency).toBe('Rs');
  });

  it('#2/#3 edits recalculate and are checked the same way', async () => {
    const { agent } = await newUser();
    const created = await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['100.00']) });
    const id = created.body.bill.id;
    const edited = await agent.put(`/api/solo-bills/${id}`).send({ bill: soloBill(['100.00'], { otherCharges: pct('10') }) });
    expect(edited.body.bill.totalCents).toBe(11000);
    const bad = await agent.put(`/api/solo-bills/${id}`).send({ bill: soloBill(['abc']) });
    expect(bad.status).toBe(400);
    expect((await agent.get(`/api/solo-bills/${id}`)).body.bill.totalCents).toBe(11000);
  });

  it('#5 delete removes it from history', async () => {
    const { agent } = await newUser();
    const created = await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['1']) });
    expect((await agent.delete(`/api/solo-bills/${created.body.bill.id}`)).status).toBe(200);
    expect((await agent.get('/api/solo-bills')).body.bills).toEqual([]);
    expect((await agent.get(`/api/solo-bills/${created.body.bill.id}`)).status).toBe(404);
  });

  it('odd ids are simply not found', async () => {
    const { agent } = await newUser();
    for (const id of ['abc', '-1', '1.5', '99999999999999999999']) {
      expect((await agent.get(`/api/solo-bills/${id}`)).status).toBe(404);
    }
  });
});

describe('US-27 all-or-nothing saves', () => {
  it('#4 a failure partway through stores nothing', async () => {
    const { agent, username } = await newUser();
    const { pool } = testApp();
    // Make item inserts fail for this account only, after the bill row is written.
    const accountId = (await pool.query('SELECT id FROM accounts WHERE username = $1', [username])).rows[0].id;
    const fn = `fail_items_${accountId}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT account_id FROM solo_bills WHERE id = NEW.bill_id) = ${accountId} THEN
          RAISE EXCEPTION 'simulated failure';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON solo_bill_items FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      const res = await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['1']) });
      expect(res.status).toBe(500);
      expect((await agent.get('/api/solo-bills')).body.bills).toEqual([]);
    } finally {
      await pool.query(`DROP TRIGGER ${fn} ON solo_bill_items; DROP FUNCTION ${fn}()`);
    }
  });
});
