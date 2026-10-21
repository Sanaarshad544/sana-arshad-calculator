import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { FieldErrors } from '../../shared/bill.js';
import type { GroupBillDetail, GroupDetail, SettleUpDto } from '../../shared/api.js';
import { MAX_FIELD_CENTS, centsToInput, parseHundredths } from '../../shared/money.js';
import { MESSAGES, restoreToChange } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { calculate, emptyBill, focusFirstError, fromInput, revealResults, stripKeys, toGroupBillInput, type BillFormState, type CalcResult } from '../billEditor.js';
import { useBusy, useLoad } from '../hooks.js';
import { BillForm } from '../components/BillForm.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Results } from '../components/Results.js';
import { useToast } from '../components/Toasts.js';
import { useUnsavedGuard } from '../components/UnsavedGuard.js';
import { Alert, ErrorText, PageHeader, Skeleton, TextField, usePageTitle } from '../components/ui.js';

interface Loaded {
  group: GroupDetail;
  bill: GroupBillDetail | null;
}

export function GroupBillPage() {
  const { groupId, billId } = useParams();
  const { data, error, loading } = useLoad<Loaded>(async () => {
    const [g, b] = await Promise.all([
      api.get<{ group: GroupDetail }>(`/groups/${groupId}`),
      billId ? api.get<{ bill: GroupBillDetail }>(`/groups/${groupId}/bills/${billId}`) : Promise.resolve(null),
    ]);
    return { group: g.group, bill: b?.bill ?? null };
  }, [groupId, billId]);
  usePageTitle(billId ? (data?.bill?.name ?? 'Group bill') : 'Add bill');

  if (loading) return <Skeleton lines={6} />;
  if (error || !data) {
    return (
      <>
        <PageHeader title="Group bill" back={{ to: groupId ? `/groups/${groupId}` : '/groups', label: 'Back to group' }} />
        <Alert>{error?.message}</Alert>
      </>
    );
  }
  return <GroupBillEditor key={billId ?? 'new'} group={data.group} saved={data.bill} />;
}

function GroupBillEditor({ group, saved }: { group: GroupDetail; saved: GroupBillDetail | null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const current = group.members.filter((m) => m.status === 'current');
  const locked = saved?.lockedBy ?? null;
  const initial = useMemo(
    () =>
      saved
        ? fromInput(saved.input)
        : emptyBill({ participantIds: current.map((m) => m.id), payerId: group.meId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved],
  );
  const [state, setState] = useState<BillFormState>(initial);
  const [snapshot] = useState(() => JSON.stringify(stripKeys(initial)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<CalcResult | null>(saved ? { totals: saved.totals, shares: saved.shares } : null);
  const [pageError, setPageError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run } = useBusy();
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const guard = useUnsavedGuard(!locked && JSON.stringify(stripKeys(state)) !== snapshot);

  // A view-only bill shows everyone on it, including removed members.
  const formMembers = (locked ? group.members : current).map((m) => ({
    id: m.id,
    name: m.status === 'removed' ? `${m.name} (removed)` : m.name,
  }));
  const names = new Map(group.members.map((m) => [m.id, m.status === 'removed' ? `${m.name} (removed)` : m.name]));
  const backTo = `/groups/${group.id}`;

  const change = (next: BillFormState) => {
    setState(next);
    setResult(null);
  };

  const onCalculate = () => {
    const outcome = calculate(state, 'group', false);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      setResult(null);
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    setErrors({});
    setResult(outcome.result);
    revealResults(resultsRef.current);
  };

  const onSave = () =>
    run(async () => {
      setPageError('');
      if (locked) {
        setPageError(restoreToChange(locked));
        return;
      }
      const outcome = calculate(state, 'group', false);
      if (!outcome.ok) {
        setErrors(outcome.errors);
        window.setTimeout(() => focusFirstError(formRef.current), 0);
        return;
      }
      setErrors({});
      try {
        const body = { bill: toGroupBillInput(state) };
        if (saved) await api.put(`/groups/${group.id}/bills/${saved.id}`, body);
        else await api.post(`/groups/${group.id}/bills`, body);
        toast('Bill saved');
        guard.allowLeave();
        navigate(backTo);
      } catch (err) {
        const e = err as ApiError;
        setErrors(e.fields);
        setPageError(Object.keys(e.fields).length ? '' : e.message);
      }
    });

  const onDelete = () =>
    run(async () => {
      if (!saved) return;
      try {
        await api.del(`/groups/${group.id}/bills/${saved.id}`);
        setConfirmDelete(false);
        toast('Bill deleted');
        guard.allowLeave();
        navigate(backTo);
      } catch (err) {
        setConfirmDelete(false);
        setPageError((err as ApiError).message);
      }
    });

  return (
    <>
      <PageHeader title={saved ? saved.name : `Add bill to ${group.name}`} back={{ to: backTo, label: group.name }}>
        {saved && (
          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={() => (locked ? setPageError(restoreToChange(locked)) : setConfirmDelete(true))}
          >
            Delete
          </button>
        )}
      </PageHeader>
      {locked && (
        <Alert tone="info">
          {locked} was removed from the group, so this bill is view only. Restore {locked} on the Members tab to change it.
        </Alert>
      )}
      <form
        ref={formRef}
        className="card stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onCalculate();
        }}
      >
        <Alert>{pageError}</Alert>
        <p className="muted">Currency: {group.currency}</p>
        <BillForm kind="group" state={state} onChange={change} errors={errors} members={formMembers} readOnly={!!locked} />
        <div className="form-actions">
          {!locked && (
            <button type="submit" className="btn btn-primary">
              Calculate
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => void onSave()} disabled={busy}>
            {busy ? 'Saving…' : 'Save bill'}
          </button>
        </div>
      </form>
      <Results ref={resultsRef} result={result} currency={group.currency} names={names} payerId={result ? state.payerId : null} />
      {guard.dialog}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this bill?"
        confirmLabel="Delete bill"
        danger
        busy={busy}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>Everyone's balances will be updated. This is recorded in the activity log.</p>
      </ConfirmDialog>
    </>
  );
}

export function SettleUpPage() {
  const { groupId, settleId } = useParams();
  const { data, error, loading } = useLoad(async () => {
    const [g, list] = await Promise.all([
      api.get<{ group: GroupDetail }>(`/groups/${groupId}`),
      settleId ? api.get<{ settleUps: SettleUpDto[] }>(`/groups/${groupId}/settle-ups`) : Promise.resolve(null),
    ]);
    const settle = settleId ? (list?.settleUps.find((s) => s.id === settleId) ?? null) : null;
    if (settleId && !settle) throw new ApiError(404, 'That payment could not be found');
    return { group: g.group, settle };
  }, [groupId, settleId]);
  usePageTitle(settleId ? 'Payment' : 'Record a payment');

  if (loading) return <Skeleton lines={4} />;
  if (error || !data) {
    return (
      <>
        <PageHeader title="Payment" back={{ to: groupId ? `/groups/${groupId}` : '/groups', label: 'Back to group' }} />
        <Alert>{error?.message}</Alert>
      </>
    );
  }
  return <SettleUpEditor key={settleId ?? 'new'} group={data.group} saved={data.settle} />;
}

function SettleUpEditor({ group, saved }: { group: GroupDetail; saved: SettleUpDto | null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const current = group.members.filter((m) => m.status === 'current');
  const locked = saved?.lockedBy ?? null;
  const people = locked ? group.members : current;
  const label = (id: string) => {
    const m = group.members.find((x) => x.id === id);
    return m ? (m.status === 'removed' ? `${m.name} (removed)` : m.name) : '';
  };
  const [fromId, setFromId] = useState(saved?.fromId ?? params.get('from') ?? '');
  const [toId, setToId] = useState(saved?.toId ?? params.get('to') ?? '');
  const [amount, setAmount] = useState(saved ? centsToInput(saved.amountCents) : (params.get('amount') ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run } = useBusy();
  const backTo = `/groups/${group.id}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setPageError('');
      if (locked) {
        setPageError(restoreToChange(locked));
        return;
      }
      const local: Record<string, string> = {};
      if (!fromId || !toId) local.people = MESSAGES.settlePeople;
      else if (fromId === toId) local.people = MESSAGES.settleSamePerson;
      const cents = parseHundredths(amount);
      if (cents === null || cents < 1 || cents > MAX_FIELD_CENTS) local.amount = MESSAGES.settleAmount;
      setErrors(local);
      if (Object.keys(local).length) return;
      try {
        const body = { fromId, toId, amount };
        if (saved) await api.put(`/groups/${group.id}/settle-ups/${saved.id}`, body);
        else await api.post(`/groups/${group.id}/settle-ups`, body);
        toast('Payment recorded');
        navigate(backTo);
      } catch (err) {
        const apiErr = err as ApiError;
        setErrors(apiErr.fields);
        if (!Object.keys(apiErr.fields).length) setPageError(apiErr.message);
      }
    });
  };

  const onDelete = () =>
    run(async () => {
      if (!saved) return;
      try {
        await api.del(`/groups/${group.id}/settle-ups/${saved.id}`);
        setConfirmDelete(false);
        toast('Payment deleted');
        navigate(backTo);
      } catch (err) {
        setConfirmDelete(false);
        setPageError((err as ApiError).message);
      }
    });

  return (
    <>
      <PageHeader title={saved ? 'Payment' : 'Record a payment'} back={{ to: backTo, label: group.name }}>
        {saved && (
          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={() => (locked ? setPageError(restoreToChange(locked)) : setConfirmDelete(true))}
          >
            Delete
          </button>
        )}
      </PageHeader>
      {locked && (
        <Alert tone="info">
          {locked} was removed from the group, so this payment is view only. Restore {locked} on the Members tab to change it.
        </Alert>
      )}
      <form className="card stack narrow" onSubmit={submit} noValidate>
        <Alert>{pageError}</Alert>
        <p className="muted">A settle-up is a record only: no money is moved by the app.</p>
        <fieldset className="stack" disabled={!!locked}>
          <legend className="visually-hidden">Who paid whom</legend>
          <div className="field">
            <label htmlFor="settle-from" className="field-label">
              Who paid
            </label>
            <select
              id="settle-from"
              className="input select"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              aria-invalid={errors.people ? true : undefined}
              aria-describedby={errors.people ? 'settle-people-error' : undefined}
            >
              <option value="">Choose a member</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {label(m.id)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="settle-to" className="field-label">
              Who received it
            </label>
            <select
              id="settle-to"
              className="input select"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              aria-invalid={errors.people ? true : undefined}
              aria-describedby={errors.people ? 'settle-people-error' : undefined}
            >
              <option value="">Choose a member</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {label(m.id)}
                </option>
              ))}
            </select>
            <ErrorText id="settle-people-error">{errors.people}</ErrorText>
          </div>
          <TextField label={`Amount (${group.currency})`} inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} />
        </fieldset>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : saved ? 'Save payment' : 'Record payment'}
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this payment?"
        confirmLabel="Delete payment"
        danger
        busy={busy}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>Balances will be updated. This is recorded in the activity log.</p>
      </ConfirmDialog>
    </>
  );
}
