import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GroupDetail, GroupSummary } from '../../shared/api.js';
import { CURRENCIES, checkCurrency, checkGroupName, normalizeInviteCode } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { withoutKey } from '../fieldErrors.js';
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
          Use an invite code
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
        return 'leaving';
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
        <TextField
          label="Group name"
          hint="Up to 50 characters"
          value={name}
          onChange={(v) => {
            setName(v);
            setErrors((e) => withoutKey(e, 'name'));
          }}
          error={errors.name}
          maxLength={200}
        />
        <CurrencyPicker
          choice={choice}
          custom={custom}
          onChange={(c, cu) => {
            setChoice(c);
            setCustom(cu);
            setErrors((e) => withoutKey(e, 'currency'));
          }}
          error={errors.currency}
          note="Every bill in this group uses this currency. You can change it later; amounts aren't converted."
        />
        <p className="muted">You'll join the group under your username. Once it's created, add friends by name and send each their own invite link.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create group'}
          </button>
        </div>
      </form>
    </>
  );
}

/** For someone who was sent a code rather than a link: type it (or paste the link), then see the invite. */
export function JoinPage() {
  usePageTitle('Use an invite code');
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fromLink = /\/invite\/([^/?#\s]+)/.exec(code)?.[1];
    const clean = normalizeInviteCode(fromLink ?? code);
    if (!clean) {
      setError('Enter the invite code you were sent');
      return;
    }
    if (!/^[A-Z0-9]+$/.test(clean)) {
      setError('Invite codes have only letters and numbers. Check the code and try again.');
      return;
    }
    navigate(`/invite/${clean}`);
  };
  return (
    <>
      <PageHeader title="Use an invite code" back={{ to: '/groups', label: 'Groups' }} />
      <form className="card stack narrow" onSubmit={submit} noValidate>
        <p className="muted">A friend who added you to their groups can send you your own invite code or link.</p>
        <TextField
          label="Invite code"
          value={code}
          onChange={(v) => {
            setCode(v);
            setError('');
          }}
          error={error}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            Continue
          </button>
        </div>
      </form>
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

/** Rename a group or change its currency. Changing the currency only relabels amounts. */
export function EditGroupPage() {
  const { groupId } = useParams();
  const { data, error, loading } = useLoad(() => api.get<{ group: GroupDetail }>(`/groups/${groupId}`).then((r) => r.group), [groupId]);
  usePageTitle('Edit group');
  if (loading) return <Skeleton lines={4} />;
  if (error || !data) {
    return (
      <>
        <PageHeader title="Edit group" back={{ to: '/groups', label: 'Groups' }} />
        <Alert>{error?.message}</Alert>
      </>
    );
  }
  return <EditGroupForm group={data} />;
}

function EditGroupForm({ group }: { group: GroupDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const listed = (CURRENCIES as readonly string[]).includes(group.currency);
  const [name, setName] = useState(group.name);
  const [choice, setChoice] = useState(listed ? group.currency : 'other');
  const [custom, setCustom] = useState(listed ? '' : group.currency);
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
        await api.put(`/groups/${group.id}`, { name, currency });
        toast('Group saved');
        navigate(`/groups/${group.id}`);
        return 'leaving';
      } catch (err) {
        const apiErr = err as ApiError;
        setErrors(apiErr.fields);
        if (!Object.keys(apiErr.fields).length) setError(apiErr.message);
      }
    });
  };

  return (
    <>
      <PageHeader title="Edit group" back={{ to: `/groups/${group.id}`, label: group.name }} />
      <form className="card stack narrow" onSubmit={submit} noValidate>
        <Alert>{error}</Alert>
        <TextField
          label="Group name"
          hint="Up to 50 characters"
          value={name}
          onChange={(v) => {
            setName(v);
            setErrors((e) => withoutKey(e, 'name'));
          }}
          error={errors.name}
          maxLength={200}
        />
        <CurrencyPicker
          choice={choice}
          custom={custom}
          onChange={(c, cu) => {
            setChoice(c);
            setCustom(cu);
            setErrors((e) => withoutKey(e, 'currency'));
          }}
          error={errors.currency}
          note="Changing the currency only changes the symbol shown on every bill. Amounts aren't converted."
        />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </>
  );
}
