import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FieldErrors } from '../../shared/bill.js';
import type { SoloBillDetail, SoloBillSummary } from '../../shared/api.js';
import { ApiError, api } from '../api.js';
import { calculate, chosenCurrency, emptyBill, focusFirstError, fromInput, rateLabels, revealResults, stripKeys, toBillInput, type BillFormState, type CalcResult } from '../billEditor.js';
import { clearFieldError, withoutKey } from '../fieldErrors.js';
import { useBusy, useFocusFirstError, useLoad } from '../hooks.js';
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
  return (
    <>
      <PageHeader title="Solo bills">
        <Link className="btn btn-primary" to="/solo/new">
          New solo bill
        </Link>
      </PageHeader>
      <Alert>{error?.message}</Alert>
      {loading && <Skeleton lines={4} />}
      {data &&
        (data.bills.length === 0 ? (
          <div className="card">
            <EmptyState text="No solo bills yet. Total your first bill to keep a record of it." action={{ to: '/solo/new', label: 'New solo bill' }} />
          </div>
        ) : (
          <ul className="link-list card">
            {data.bills.map((b) => (
              <li key={b.id}>
                <Link to={`/solo/${b.id}`} className="link-row">
                  <span className="link-row-title">
                    {b.name}
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

/** New solo bill (no id) or a saved one (opened for editing). */
export function SoloBillPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const { data, error, loading, reload } = useLoad(
    () => (isNew ? Promise.resolve(null) : api.get<{ bill: SoloBillDetail }>(`/solo-bills/${id}`).then((r) => r.bill)),
    [id],
  );
  usePageTitle(isNew ? 'New solo bill' : (data?.name ?? 'Solo bill'));
  const [version, setVersion] = useState(0);

  if (loading) return <Skeleton lines={6} />;
  if (error) {
    return (
      <>
        <PageHeader title="Solo bill" back={{ to: '/solo', label: 'Solo bills' }} />
        <Alert>{error.message}</Alert>
      </>
    );
  }
  return (
    <SoloBillEditor
      key={`${id ?? 'new'}-${version}`}
      saved={data}
      onSavedEdit={() => reload().then(() => setVersion((v) => v + 1))}
    />
  );
}

function SoloBillEditor({ saved, onSavedEdit }: { saved: SoloBillDetail | null; onSavedEdit: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const initial = useMemo(() => (saved ? fromInput(saved.input, saved.currency) : emptyBill()), [saved]);
  const [state, setState] = useState<BillFormState>(initial);
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(stripKeys(initial)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<CalcResult | null>(saved ? { totals: saved.totals, shares: null } : null);
  const [pageError, setPageError] = useState('');
  // Problems with Delete show at the top, next to the button that caused them.
  const [headerError, setHeaderError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run } = useBusy();
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const focusErrors = useFocusFirstError(formRef);
  const dirty = JSON.stringify(stripKeys(state)) !== snapshot;
  const guard = useUnsavedGuard(dirty);
  const currency = saved ? saved.currency : chosenCurrency(state);

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
        setSnapshot(JSON.stringify(stripKeys(state)));
        toast('Bill saved');
        if (saved) {
          onSavedEdit();
        } else {
          guard.allowLeave();
          navigate(`/solo/${r.bill.id}`, { replace: true });
        }
      } catch (err) {
        const e = err as ApiError;
        setErrors(e.fields);
        setPageError(e.message);
        if (Object.keys(e.fields).length) focusErrors();
      }
    });

  const onDelete = () =>
    run(async () => {
      if (!saved) return;
      setHeaderError('');
      try {
        await api.del(`/solo-bills/${saved.id}`);
        guard.allowLeave();
        setConfirmDelete(false);
        toast('Bill deleted');
        navigate('/solo', { replace: true });
      } catch (err) {
        setConfirmDelete(false);
        setHeaderError((err as ApiError).message);
      }
    });

  return (
    <>
      <PageHeader title={saved ? saved.name : 'New solo bill'} back={{ to: '/solo', label: 'Solo bills' }}>
        {saved && (
          <button type="button" className="btn btn-danger-outline" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </PageHeader>
      <Alert>{headerError}</Alert>
      <form
        ref={formRef}
        className="card stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onCalculate();
        }}
      >
        {saved ? (
          <div className="field">
            <span className="field-label">Currency</span>
            <p>
              <strong>{saved.currency}</strong> <span className="muted">— can't be changed after the bill is saved.</span>
            </p>
          </div>
        ) : (
          <CurrencyPicker
            choice={state.currencyChoice}
            custom={state.customCurrency}
            note="Only changes the symbol shown; nothing is converted. It can't be changed after you save."
            onChange={(currencyChoice, customCurrency) => {
              setErrors((e) => withoutKey(e, 'currency'));
              change({ ...state, currencyChoice, customCurrency });
            }}
            error={errors.currency}
          />
        )}
        <BillForm kind="solo" state={state} onChange={change} errors={errors} onFieldEdit={(key) => setErrors((e) => clearFieldError(e, key))} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            Calculate
          </button>
        </div>
      </form>
      <Results ref={resultsRef} result={result} currency={currency.trim() || '$'} rates={rateLabels(state)} />
      <div className="save-bar">
        <Alert>{pageError}</Alert>
        <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={busy}>
          {busy ? 'Saving…' : 'Save bill'}
        </button>
      </div>
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
        <p>It will be removed from your history for good.</p>
      </ConfirmDialog>
    </>
  );
}
