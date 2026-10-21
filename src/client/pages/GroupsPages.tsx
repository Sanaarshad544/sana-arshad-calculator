import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GroupSummary, JoinResult } from '../../shared/api.js';
import { checkCurrency, checkGroupName } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { useBusy, useLoad } from '../hooks.js';
import { CurrencyPicker } from '../components/CurrencyPicker.js';
import { useToast } from '../components/Toasts.js';
import { Alert, Balance, EmptyState, PageHeader, Skeleton, TextField, usePageTitle } from '../components/ui.js';

export function GroupsPage() {
  usePageTitle('Groups');
  const { data, error, loading } = useLoad(() => api.get<{ groups: GroupSummary[] }>('/groups'), []);
  return (
    <>
      <PageHeader title="Groups">
        <Link className="btn btn-secondary" to="/join">
          Join with a code
        </Link>
        <Link className="btn btn-primary" to="/groups/new">
          Create group
        </Link>
      </PageHeader>
      <Alert>{error?.message}</Alert>
      {loading && <Skeleton lines={4} />}
      {data &&
        (data.groups.length === 0 ? (
          <div className="card">
            <EmptyState text="No groups yet. Create one to start splitting with friends." action={{ to: '/groups/new', label: 'Create group' }} />
          </div>
        ) : (
          <ul className="link-list card">
            {data.groups.map((g) => (
              <li key={g.id}>
                <Link to={`/groups/${g.id}`} className="link-row">
                  <span className="link-row-title">
                    {g.name} <span className="muted small">· {g.currency}</span>
                  </span>
                  <Balance cents={g.myBalanceCents} currency={g.currency} />
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

export function NewGroupPage() {
  usePageTitle('Create group');
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [choice, setChoice] = useState('$');
  const [custom, setCustom] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const currency = choice === 'other' ? custom : choice;
    const n = checkGroupName(name);
    const c = checkCurrency(currency);
    const local: Record<string, string> = {};
    if (!n.ok) local.name = n.message;
    if (!c.ok) local.currency = c.message;
    setErrors(local);
    setError('');
    if (!n.ok || !c.ok) return;
    void run(async () => {
      try {
        const r = await api.post<{ groupId: string }>('/groups', { name, currency });
        toast('Group created');
        navigate(`/groups/${r.groupId}`, { replace: true });
      } catch (err) {
        const apiErr = err as ApiError;
        setErrors(apiErr.fields);
        if (!Object.keys(apiErr.fields).length) setError(apiErr.message);
      }
    });
  };

  return (
    <>
      <PageHeader title="Create group" back={{ to: '/groups', label: 'Groups' }} />
      <form className="card stack narrow" onSubmit={submit} noValidate>
        <Alert>{error}</Alert>
        <TextField label="Group name" hint="1–50 characters" value={name} onChange={setName} error={errors.name} maxLength={200} />
        <CurrencyPicker
          choice={choice}
          custom={custom}
          onChange={(c, cu) => {
            setChoice(c);
            setCustom(cu);
          }}
          error={errors.currency}
          note="Every bill in this group uses this currency. It can't be changed after the group is created."
        />
        <p className="muted">You'll join the group under your username. Add friends by name once it's created.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create group'}
          </button>
        </div>
      </form>
    </>
  );
}

export function JoinPage() {
  usePageTitle('Join a group');
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [choose, setChoose] = useState<Extract<JoinResult, { status: 'choose' }> | null>(null);
  const [memberId, setMemberId] = useState('');
  const { busy, run } = useBusy();

  const lookUp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setError('');
      setChoose(null);
      try {
        const r = await api.post<JoinResult>('/join', { code });
        if (r.status === 'rejoined') {
          toast('Welcome back');
          navigate(`/groups/${r.groupId}`);
        } else {
          setChoose(r);
          setMemberId('');
        }
      } catch (err) {
        setError((err as ApiError).message);
      }
    });
  };

  const claim = (e: FormEvent) => {
    e.preventDefault();
    if (!memberId) {
      setError('Choose your name from the list');
      return;
    }
    void run(async () => {
      try {
        const r = await api.post<{ groupId: string }>('/join/claim', { code, memberId });
        toast('You joined the group');
        navigate(`/groups/${r.groupId}`);
      } catch (err) {
        setError((err as ApiError).message);
      }
    });
  };

  return (
    <>
      <PageHeader title="Join a group" back={{ to: '/groups', label: 'Groups' }} />
      <div className="stack-lg narrow">
        <form className="card stack" onSubmit={lookUp} noValidate>
          <p className="muted">Ask a member of the group for its invite code.</p>
          <Alert>{!choose ? error : ''}</Alert>
          <TextField label="Invite code" value={code} onChange={setCode} autoCapitalize="characters" autoComplete="off" />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && !choose ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </form>
        {choose && (
          <form className="card stack" onSubmit={claim} noValidate>
            <h2 className="section-title">Which name is you in “{choose.groupName}”?</h2>
            <Alert>{error}</Alert>
            {choose.choices.length === 0 ? (
              <p>
                Every name in this group is already taken. Ask a member to add your name first, then enter the code again.
              </p>
            ) : (
              <fieldset>
                <legend className="visually-hidden">Choose your name</legend>
                <div className="radio-col">
                  {choose.choices.map((c) => (
                    <label key={c.memberId} className="check">
                      <input type="radio" name="claim" checked={memberId === c.memberId} onChange={() => setMemberId(c.memberId)} />
                      <span>
                        I'm {c.name}
                        {c.removed && <span className="muted"> (removed)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {choose.choices.length > 0 && (
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Joining…' : 'Join group'}
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </>
  );
}

/** "New group bill" from the Dashboard: pick which group it belongs to. */
export function ChooseGroupPage() {
  usePageTitle('New group bill');
  const { data, error, loading } = useLoad(() => api.get<{ groups: GroupSummary[] }>('/groups'), []);
  return (
    <>
      <PageHeader title="New group bill" back={{ to: '/', label: 'Dashboard' }} />
      <Alert>{error?.message}</Alert>
      {loading && <Skeleton lines={3} />}
      {data &&
        (data.groups.length === 0 ? (
          <div className="card">
            <EmptyState text="Group bills belong to a group. Create one first, then add friends to it." action={{ to: '/groups/new', label: 'Create group' }} />
          </div>
        ) : (
          <section className="card" aria-labelledby="pick-group">
            <h2 id="pick-group" className="section-title">
              Which group is this bill for?
            </h2>
            <ul className="link-list">
              {data.groups.map((g) => (
                <li key={g.id}>
                  <Link className="link-row" to={`/groups/${g.id}/bills/new`}>
                    <span className="link-row-title">{g.name}</span>
                    <span className="muted">{g.currency}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
