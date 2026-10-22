import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { FieldErrors } from '../../shared/bill.js';
import type { GroupBillDetail, GroupDetail, SettleUpDto } from '../../shared/api.js';
import { MAX_FIELD_CENTS, centsToInput, parseHundredths } from '../../shared/money.js';
import { MESSAGES, restoreToChange } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { calculate, emptyBill, focusFirstError, fromInput, rateLabels, revealResults, stripKeys, toFormErrors, toGroupBillInput, type BillFormState, type CalcResult } from '../billEditor.js';
import { clearFieldError, withoutKey } from '../fieldErrors.js';
import { useBusy, useFocusFirstError, useLoad, useShowSavedBill } from '../hooks.js';
import { BillForm } from '../components/BillForm.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CurrencyNote } from '../components/CurrencyNote.js';
import { Results } from '../components/Results.js';
import { useToast } from '../components/Toasts.js';
import { useUnsavedGuard } from '../components/UnsavedGuard.js';
import { Alert, ErrorText, PageHeader, Skeleton, TextField, niceDate, usePageTitle } from '../components/ui.js';

interface Loaded {
  group: GroupDetail;
  bill: GroupBillDetail | null;
}

function useGroupBill(groupId: string | undefined, billId: string | undefined) {
  return useLoad<Loaded>(async () => {
    const [g, b] = await Promise.all([
      api.get<{ group: GroupDetail }>(`/groups/${groupId}`),
      billId ? api.get<{ bill: GroupBillDetail }>(`/groups/${groupId}/bills/${billId}`) : Promise.resolve(null),
    ]);
    return { group: g.group, bill: b?.bill ?? null };
  }, [groupId, billId]);
}

/** Members by id, with "(removed)" after anyone who has been removed. */
function memberNames(group: GroupDetail): Map<string, string> {
  return new Map(group.members.map((m) => [m.id, m.status === 'removed' ? `${m.name} (removed)` : m.name]));
}

/** A saved group bill, read-only: the receipt with items and each share, plus Edit and Delete. */
export function GroupBillViewPage() {
  const { groupId, billId } = useParams();
  const { data, error, loading } = useGroupBill(groupId, billId);
  usePageTitle(data?.bill?.name ?? 'Group bill');
  if (loading) return <Skeleton lines={6} />;
  if (error || !data?.bill) {
    return (
      <>
        <PageHeader title="Group bill" back={{ to: groupId ? `/groups/${groupId}` : '/groups', label: 'Back to group' }} />
        <Alert>{error?.message}</Alert>
      </>
    );
  }
  return <GroupBillView group={data.group} bill={data.bill} />;
}

function GroupBillView({ group, bill }: { group: GroupDetail; bill: GroupBillDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [headerError, setHeaderError] = useState('');
  const { busy, run } = useBusy();
  const locked = bill.lockedBy;
  const names = memberNames(group);
  const backTo = `/groups/${group.id}`;
  const itemized = bill.splitMode === 'itemized';
  const people = bill.participantIds.length;
  const items = bill.input.items.map((it, i) => ({
    name: it.name || `Item ${i + 1}`,
    cents: parseHundredths(it.price),
    sharedBy: itemized ? (it.sharerIds ?? []).map((id) => names.get(id) ?? 'Someone').join(', ') : undefined,
  }));

  const onDelete = () =>
    run(async () => {
      setHeaderError('');
      try {
        await api.del(`/groups/${group.id}/bills/${bill.id}`);
        setConfirmDelete(false);
        toast('Bill deleted');
        navigate(backTo, { replace: true });
        return 'leaving';
      } catch (err) {
        setConfirmDelete(false);
        setHeaderError((err as ApiError).message);
      }
    });

  return (
    <>
      <PageHeader title={bill.name} back={{ to: backTo, label: group.name }}>
        {!locked && (
          <Link className="btn btn-primary" to={`/groups/${group.id}/bills/${bill.id}/edit`}>
            Edit bill
          </Link>
        )}
        <button
          type="button"
          className="btn btn-danger-outline"
          onClick={() => (locked ? setHeaderError(restoreToChange(locked)) : setConfirmDelete(true))}
        >
          Delete
        </button>
      </PageHeader>
      <Alert>{headerError}</Alert>
      {locked && (
        <Alert tone="info">
          {locked} was removed from the group, so this bill is view only. Restore {locked} on the Members tab to change it.
        </Alert>
      )}
      <p className="bill-summary">
        {names.get(bill.payerId) ?? 'Someone'} paid on {niceDate(bill.date)}.{' '}
        {itemized ? 'Split by items.' : `Split equally between ${people} ${people === 1 ? 'person' : 'people'}.`}
      </p>
      <Results
        result={{ totals: bill.totals, shares: bill.shares }}
        currency={group.currency}
        names={names}
        payerId={bill.payerId}
        rates={rateLabels(fromInput(bill.input))}
        title="Bill"
        items={items}
      />
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

/** A new group bill, or a saved one being edited (…/bills/:billId/edit). */
export function GroupBillPage() {
  const { groupId, billId } = useParams();
  const { data, error, loading } = useGroupBill(groupId, billId);
  usePageTitle(billId ? (data?.bill ? `Edit ${data.bill.name}` : 'Edit bill') : 'Add bill');

  if (loading) return <Skeleton lines={6} />;
  if (error || !data) {
    return (
      <>
        <PageHeader title="Group bill" back={{ to: groupId ? `/groups/${groupId}` : '/groups', label: 'Back to group' }} />
        <Alert>{error?.message}</Alert>
      </>
    );
  }
  // A bill with a removed member can't be changed: show it read-only instead.
  if (data.bill?.lockedBy) return <Navigate to={`/groups/${data.group.id}/bills/${data.bill.id}`} replace />;
  return <GroupBillEditor key={billId ?? 'new'} group={data.group} saved={data.bill} />;
}

function GroupBillEditor({ group, saved }: { group: GroupDetail; saved: GroupBillDetail | null }) {
  const toast = useToast();
  const formId = useId();
  const current = group.members.filter((m) => m.status === 'current');
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
  const { busy, run } = useBusy();
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const focusErrors = useFocusFirstError(formRef);
  const guard = useUnsavedGuard(JSON.stringify(stripKeys(state)) !== snapshot);
  const showSaved = useShowSavedBill();

  const formMembers = current.map((m) => ({ id: m.id, name: m.name }));
  const names = memberNames(group);
  const backTo = `/groups/${group.id}`;
  const viewPath = saved ? `/groups/${group.id}/bills/${saved.id}` : backTo;

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
      const outcome = calculate(state, 'group', false);
      if (!outcome.ok) {
        setErrors(outcome.errors);
        window.setTimeout(() => focusFirstError(formRef.current), 0);
        return;
      }
      setErrors({});
      try {
        const body = { bill: toGroupBillInput(state) };
        let billId: string;
        if (saved) {
          await api.put(`/groups/${group.id}/bills/${saved.id}`, body);
          billId = saved.id;
        } else {
          billId = (await api.post<{ billId: string }>(`/groups/${group.id}/bills`, body)).billId;
        }
        toast('Bill saved');
        guard.allowLeave();
        // Back to the group's bill list, with this bill marked as just saved.
        showSaved(backTo, billId);
        return 'leaving';
      } catch (err) {
        const e = err as ApiError;
        setErrors(toFormErrors(state, e.fields));
        setPageError(e.message);
        if (Object.keys(e.fields).length) focusErrors();
      }
    });

  return (
    <>
      <PageHeader title={saved ? `Edit ${saved.name}` : `Add bill to ${group.name}`} back={{ to: viewPath, label: saved ? saved.name : group.name }}>
        {saved && (
          <Link className="btn btn-secondary" to={viewPath}>
            Cancel
          </Link>
        )}
      </PageHeader>
      <CurrencyNote currency={group.currency} className="page-meta" />
      <div className="bill-layout">
        <form
          id={formId}
          ref={formRef}
          className="card stack bill-card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onCalculate();
          }}
        >
          <BillForm
            kind="group"
            state={state}
            onChange={change}
            errors={errors}
            currency={group.currency}
            members={formMembers}
            onFieldEdit={(key) => setErrors((e) => clearFieldError(e, key))}
          />
        </form>
        <div className="bill-side">
          <button type="submit" form={formId} className="btn btn-secondary btn-wide">
            Calculate
          </button>
          <Results
            ref={resultsRef}
            result={result}
            currency={group.currency}
            names={names}
            payerId={result ? state.payerId : null}
            rates={rateLabels(state)}
          />
          <div className="save-bar">
            <Alert>{pageError}</Alert>
            <button type="button" className="btn btn-primary btn-wide" onClick={() => void onSave()} disabled={busy}>
              {busy ? 'Saving…' : 'Save bill'}
            </button>
          </div>
        </div>
      </div>
      {guard.dialog}
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
        return 'leaving';
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
        return 'leaving';
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
              onChange={(e) => {
                setFromId(e.target.value);
                setErrors((x) => withoutKey(x, 'people'));
              }}
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
              onChange={(e) => {
                setToId(e.target.value);
                setErrors((x) => withoutKey(x, 'people'));
              }}
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
          <TextField
            label={`Amount (${group.currency})`}
            inputMode="decimal"
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setErrors((x) => withoutKey(x, 'amount'));
            }}
            error={errors.amount}
          />
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
