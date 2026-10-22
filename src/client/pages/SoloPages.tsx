import { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FieldErrors } from '../../shared/bill.js';
import type { SoloBillDetail, SoloBillSummary } from '../../shared/api.js';
import { parseHundredths } from '../../shared/money.js';
import { ApiError, api } from '../api.js';
import { calculate, chosenCurrency, emptyBill, focusFirstError, fromInput, rateLabels, revealResults, stripKeys, toFormErrors, toBillInput, type BillFormState, type CalcResult } from '../billEditor.js';
import { clearFieldError, withoutKey } from '../fieldErrors.js';
import { FROM_LIST, useBusy, useFocusFirstError, useLoad, useSavedBill, useShowSavedBill } from '../hooks.js';
import { BillForm } from '../components/BillForm.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CurrencyPicker } from '../components/CurrencyPicker.js';
import { Results } from '../components/Results.js';
import { useToast } from '../components/Toasts.js';
import { useUnsavedGuard } from '../components/UnsavedGuard.js';
import { Alert, EmptyState, PageHeader, Skeleton, money, niceDate, usePageTitle } from '../components/ui.js';

export function SoloListPage() {
  usePageTitle('Solo bills');
  const { data, error, loading } = useLoad(() => api.get<{ bills: SoloBillSummary[] }>('/solo-bills'), []);
  const { savedId, rowRef } = useSavedBill(data !== null);
  return (
    <>
      <PageHeader title="Solo bills">
        <Link className="btn btn-primary" to="/solo/new" state={FROM_LIST}>
          New solo bill
        </Link>
      </PageHeader>
      <Alert>{error?.message}</Alert>
      {loading && <Skeleton lines={4} />}
      {data &&
        (data.bills.length === 0 ? (
          <div className="card">
            <EmptyState text="No solo bills yet. Total your first bill to keep a record of it." action={{ to: '/solo/new', label: 'New solo bill', state: FROM_LIST }} />
          </div>
        ) : (
          <ul className="link-list card">
            {data.bills.map((b) => (
              <li key={b.id}>
                <Link
                  to={`/solo/${b.id}`}
                  className={b.id === savedId ? 'link-row link-row-saved' : 'link-row'}
                  ref={b.id === savedId ? rowRef : undefined}
                >
                  <span className="link-row-title">
                    {b.name}
                    {b.id === savedId && <>{' '}<span className="badge badge-saved">Saved</span></>}
                    <span className="muted small"> · {niceDate(b.date)} · {b.currency}</span>
                  </span>
                  <span>{money(b.totalCents, b.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

/** A saved solo bill, read-only: the receipt with its items, plus Edit and Delete. */
export function SoloBillViewPage() {
  const { id } = useParams();
  const { data, error, loading } = useLoad(() => api.get<{ bill: SoloBillDetail }>(`/solo-bills/${id}`).then((r) => r.bill), [id]);
  usePageTitle(data?.name ?? 'Solo bill');
  if (loading) return <Skeleton lines={6} />;
  if (error || !data) {
    return (
      <>
        <PageHeader title="Solo bill" back={{ to: '/solo', label: 'Solo bills' }} />
        <Alert>{error?.message}</Alert>
      </>
    );
  }
  return <SoloBillView bill={data} />;
}

function SoloBillView({ bill }: { bill: SoloBillDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [headerError, setHeaderError] = useState('');
  const { busy, run } = useBusy();
  const items = bill.input.items.map((it, i) => ({ name: it.name || `Item ${i + 1}`, cents: parseHundredths(it.price) }));

  const onDelete = () =>
    run(async () => {
      setHeaderError('');
      try {
        await api.del(`/solo-bills/${bill.id}`);
        setConfirmDelete(false);
        toast('Bill deleted');
        navigate('/solo', { replace: true });
        return 'leaving';
      } catch (err) {
        setConfirmDelete(false);
        setHeaderError((err as ApiError).message);
      }
    });

  return (
    <>
      <PageHeader title={bill.name} back={{ to: '/solo', label: 'Solo bills' }}>
        <Link className="btn btn-primary" to={`/solo/${bill.id}/edit`}>
          Edit bill
        </Link>
        <button type="button" className="btn btn-danger-outline" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </PageHeader>
      <Alert>{headerError}</Alert>
      <p className="bill-summary">
        Bill from {niceDate(bill.date)}. Amounts in {bill.currency}.
      </p>
      <Results
        result={{ totals: bill.totals, shares: null }}
        currency={bill.currency}
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
        <p>It will be removed from your history for good.</p>
      </ConfirmDialog>
    </>
  );
}

/** A new solo bill (no id), or a saved one being edited (/solo/:id/edit). */
export function SoloBillPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const { data, error, loading } = useLoad(
    () => (isNew ? Promise.resolve(null) : api.get<{ bill: SoloBillDetail }>(`/solo-bills/${id}`).then((r) => r.bill)),
    [id],
  );
  usePageTitle(isNew ? 'New solo bill' : data ? `Edit ${data.name}` : 'Edit solo bill');

  if (loading) return <Skeleton lines={6} />;
  if (error) {
    return (
      <>
        <PageHeader title="Solo bill" back={{ to: '/solo', label: 'Solo bills' }} />
        <Alert>{error.message}</Alert>
      </>
    );
  }
  return <SoloBillEditor key={id ?? 'new'} saved={data} />;
}

function SoloBillEditor({ saved }: { saved: SoloBillDetail | null }) {
  const toast = useToast();
  const formId = useId();
  const initial = useMemo(() => (saved ? fromInput(saved.input, saved.currency) : emptyBill()), [saved]);
  const [state, setState] = useState<BillFormState>(initial);
  const [snapshot] = useState(() => JSON.stringify(stripKeys(initial)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<CalcResult | null>(saved ? { totals: saved.totals, shares: null } : null);
  const [pageError, setPageError] = useState('');
  const { busy, run } = useBusy();
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const focusErrors = useFocusFirstError(formRef);
  const guard = useUnsavedGuard(JSON.stringify(stripKeys(state)) !== snapshot);
  const showSaved = useShowSavedBill();
  const currency = saved ? saved.currency : chosenCurrency(state);
  const viewPath = saved ? `/solo/${saved.id}` : '/solo';

  const change = (next: BillFormState) => {
    setState(next);
    setResult(null); // any change hides the old result
  };

  const onCalculate = () => {
    const outcome = calculate(state, 'solo', !saved);
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
      const outcome = calculate(state, 'solo', !saved);
      if (!outcome.ok) {
        setErrors(outcome.errors);
        window.setTimeout(() => focusFirstError(formRef.current), 0);
        return;
      }
      setErrors({});
      try {
        const body = { currency: chosenCurrency(state), bill: toBillInput(state) };
        const r = saved
          ? await api.put<{ bill: SoloBillSummary }>(`/solo-bills/${saved.id}`, body)
          : await api.post<{ bill: SoloBillSummary }>('/solo-bills', body);
        toast('Bill saved');
        guard.allowLeave();
        // Back to where the bill is listed, with it marked as just saved.
        showSaved('/solo', r.bill.id);
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
      <PageHeader title={saved ? `Edit ${saved.name}` : 'New solo bill'} back={saved ? { to: viewPath, label: saved.name } : { to: '/solo', label: 'Solo bills' }}>
        {saved && (
          <Link className="btn btn-secondary" to={viewPath}>
            Cancel
          </Link>
        )}
      </PageHeader>
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
          {saved ? (
            <div className="field">
              <span className="field-label">Currency</span>
              <p className="currency-fixed">
                <strong>{saved.currency}</strong>
              </p>
              <p className="field-hint">
                A saved bill keeps its currency. To use a different one, delete this bill and add it again with the right currency.
              </p>
            </div>
          ) : (
            <CurrencyPicker
              choice={state.currencyChoice}
              custom={state.customCurrency}
              note="Only the symbol shown next to amounts; nothing is converted. Once the bill is saved, its currency can't be changed."
              onChange={(currencyChoice, customCurrency) => {
                setErrors((e) => withoutKey(e, 'currency'));
                change({ ...state, currencyChoice, customCurrency });
              }}
              error={errors.currency}
            />
          )}
          <BillForm
            kind="solo"
            state={state}
            onChange={change}
            errors={errors}
            currency={currency}
            onFieldEdit={(key) => setErrors((e) => clearFieldError(e, key))}
          />
        </form>
        <div className="bill-side">
          <button type="submit" form={formId} className="btn btn-secondary btn-wide">
            Calculate
          </button>
          <Results ref={resultsRef} result={result} currency={currency.trim() || '$'} rates={rateLabels(state)} />
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
