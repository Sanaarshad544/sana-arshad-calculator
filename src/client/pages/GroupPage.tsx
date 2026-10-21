import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActivityDto, GroupBillSummary, GroupDetail, MemberDto, SettleUpDto } from '../../shared/api.js';
import { centsToInput } from '../../shared/money.js';
import { MESSAGES, checkMemberName } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { useBusy, useLoad } from '../hooks.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useToast } from '../components/Toasts.js';
import { Alert, Balance, EmptyState, PageHeader, Skeleton, TextField, money, niceDate, niceDateTime, usePageTitle } from '../components/ui.js';

const TABS = [
  { id: 'bills', label: 'Bills' },
  { id: 'settle-ups', label: 'Settle-ups' },
  { id: 'members', label: 'Members' },
  { id: 'activity', label: 'Activity' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function GroupPage() {
  const { groupId } = useParams();
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ group: GroupDetail }>(`/groups/${groupId}`).then((r) => r.group),
    [groupId],
  );
  usePageTitle(data?.name ?? 'Group');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'bills') as TabId;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (loading) return <Skeleton lines={6} />;
  if (error || !data) {
    return (
      <>
        <PageHeader title="Group" back={{ to: '/groups', label: 'Groups' }} />
        <Alert>{error?.message ?? MESSAGES.groupGone}</Alert>
      </>
    );
  }

  const group = data;
  const names = new Map(group.members.map((m) => [m.id, m.status === 'removed' ? `${m.name} (removed)` : m.name]));
  const current = group.members.filter((m) => m.status === 'current');

  const selectTab = (id: TabId, focus = false) => {
    setParams(id === 'bills' ? {} : { tab: id }, { replace: true });
    if (focus) tabRefs.current[TABS.findIndex((t) => t.id === id)]?.focus();
  };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Count from the tab that has focus, so quick key presses never skip one.
    const focused = tabRefs.current.findIndex((el) => el === document.activeElement);
    const i = focused >= 0 ? focused : TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next >= 0) {
      e.preventDefault();
      selectTab(TABS[next].id, true);
    }
  };

  return (
    <>
      <PageHeader title={group.name} back={{ to: '/groups', label: 'Groups' }}>
        <Link className="btn btn-primary" to={`/groups/${group.id}/bills/new`}>
          Add bill
        </Link>
      </PageHeader>
      <p className="muted group-meta">Currency: {group.currency}</p>

      <div className="grid-2">
        <section className="card" aria-labelledby="balances-heading">
          <h2 id="balances-heading" className="section-title">
            Balances
          </h2>
          <ul className="balance-list">
            {current.map((m) => (
              <li key={m.id} className="balance-row" data-testid="balance-row">
                <span className="person">
                  <span className="avatar" aria-hidden="true">
                    {Array.from(m.name)[0]?.toUpperCase()}
                  </span>
                  {m.name}
                  {m.isMe && <span className="muted"> (you)</span>}
                </span>
                <Balance cents={m.balanceCents} currency={group.currency} />
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="suggest-heading">
          <h2 id="suggest-heading" className="section-title">
            Suggested payments
          </h2>
          {group.suggestions.length === 0 ? (
            <p className="muted">Everyone is settled up.</p>
          ) : (
            <ul className="suggest-list">
              {group.suggestions.map((s) => (
                <li key={`${s.fromId}-${s.toId}`} className="suggest-row" data-testid="suggestion">
                  <span>
                    {names.get(s.fromId)} pays {names.get(s.toId)} {money(s.amountCents, group.currency)}
                  </span>
                  <Link
                    className="btn btn-secondary btn-small"
                    to={`/groups/${group.id}/settle-ups/new?from=${s.fromId}&to=${s.toId}&amount=${centsToInput(s.amountCents)}`}
                  >
                    Record this payment
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="tabs" role="tablist" aria-label="Group sections" onKeyDown={onTabKey}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'tab tab-on' : 'tab'}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="card tab-panel" tabIndex={0}>
        {tab === 'bills' && <BillsTab group={group} names={names} />}
        {tab === 'settle-ups' && <SettleUpsTab group={group} names={names} />}
        {tab === 'members' && <MembersTab group={group} reload={reload} />}
        {tab === 'activity' && <ActivityTab groupId={group.id} />}
      </div>
    </>
  );
}

function BillsTab({ group, names }: { group: GroupDetail; names: Map<string, string> }) {
  const { data, error, loading } = useLoad(() => api.get<{ bills: GroupBillSummary[] }>(`/groups/${group.id}/bills`), [group.id]);
  if (loading) return <Skeleton lines={3} />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data || data.bills.length === 0) {
    return <EmptyState text="No bills yet. Add the first bill you shared." action={{ to: `/groups/${group.id}/bills/new`, label: 'Add bill' }} />;
  }
  return (
    <ul className="link-list">
      {data.bills.map((b) => (
        <li key={b.id}>
          <Link to={`/groups/${group.id}/bills/${b.id}`} className="link-row">
            <span className="link-row-title">
              {b.name}
              <span className="muted small">
                {' '}
                · {niceDate(b.date)} · paid by {names.get(b.payerId)} · {b.splitMode === 'equal' ? 'split equally' : 'by items'}
              </span>
              {b.lockedBy && <span className="badge badge-muted">View only</span>}
            </span>
            <span>{money(b.totalCents, group.currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SettleUpsTab({ group, names }: { group: GroupDetail; names: Map<string, string> }) {
  const { data, error, loading } = useLoad(() => api.get<{ settleUps: SettleUpDto[] }>(`/groups/${group.id}/settle-ups`), [group.id]);
  if (loading) return <Skeleton lines={3} />;
  if (error) return <Alert>{error.message}</Alert>;
  return (
    <div className="stack">
      <div>
        <Link className="btn btn-secondary" to={`/groups/${group.id}/settle-ups/new`}>
          Record a payment
        </Link>
      </div>
      {!data || data.settleUps.length === 0 ? (
        <EmptyState text="No settle-ups yet. When someone pays another member back, record it here so balances stay right." />
      ) : (
        <ul className="link-list">
          {data.settleUps.map((s) => (
            <li key={s.id}>
              <Link to={`/groups/${group.id}/settle-ups/${s.id}`} className="link-row">
                <span className="link-row-title">
                  {names.get(s.fromId)} paid {names.get(s.toId)}
                  <span className="muted small"> · {niceDate(s.date)}</span>
                  {s.lockedBy && <span className="badge badge-muted">View only</span>}
                </span>
                <span>{money(s.amountCents, group.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PendingAction = { kind: 'remove'; member: MemberDto } | { kind: 'leave' } | null;

function MembersTab({ group, reload }: { group: GroupDetail; reload: () => Promise<void> }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [copied, setCopied] = useState(false);
  const { busy, run } = useBusy();
  const current = group.members.filter((m) => m.status === 'current');
  const removed = group.members.filter((m) => m.status === 'removed');

  const addMember = (e: FormEvent) => {
    e.preventDefault();
    const check = checkMemberName(newName);
    if (!check.ok) {
      setNameError(check.message);
      return;
    }
    void run(async () => {
      try {
        await api.post(`/groups/${group.id}/members`, { name: newName });
        setNewName('');
        setNameError('');
        toast('Member added');
        await reload();
      } catch (err) {
        const e2 = err as ApiError;
        setNameError(e2.fields.name ?? e2.message);
      }
    });
  };

  const confirm = () =>
    run(async () => {
      if (!pending) return;
      setError('');
      try {
        if (pending.kind === 'remove') {
          await api.post(`/groups/${group.id}/members/${pending.member.id}/remove`);
          setPending(null);
          toast('Member removed');
          await reload();
        } else {
          const r = await api.post<{ outcome: 'left' | 'deleted' }>(`/groups/${group.id}/leave`, { confirmDelete: group.iAmLastAccount });
          setPending(null);
          toast(r.outcome === 'deleted' ? 'Group deleted' : 'You left the group');
          navigate('/groups', { replace: true });
        }
      } catch (err) {
        setPending(null);
        setError((err as ApiError).message);
      }
    });

  const restore = (m: MemberDto) =>
    run(async () => {
      setError('');
      try {
        await api.post(`/groups/${group.id}/members/${m.id}/restore`);
        toast('Member restored');
        await reload();
      } catch (err) {
        setError((err as ApiError).message);
      }
    });

  return (
    <div className="stack-lg">
      <Alert>{error}</Alert>
      <section aria-labelledby="current-heading">
        <h2 id="current-heading" className="section-title">
          Members ({current.length})
        </h2>
        <ul className="member-list">
          {current.map((m) => (
            <li key={m.id} className="member-row">
              <span>
                {m.name}
                {m.isMe && <span className="muted"> (you)</span>}
                <span className="muted small"> · {m.hasAccount ? 'has an account' : 'name only'}</span>
              </span>
              {!m.isMe && (
                <button type="button" className="btn btn-danger-outline btn-small" onClick={() => setPending({ kind: 'remove', member: m })}>
                  Remove<span className="visually-hidden"> {m.name}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={addMember} noValidate>
          <TextField label="Add a friend by name" value={newName} onChange={setNewName} error={nameError} maxLength={200} />
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            Add member
          </button>
        </form>
      </section>

      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="section-title">
          Invite code
        </h2>
        <p className="muted">Friends you added by name can enter this code to take over their own name.</p>
        <div className="row">
          <code className="invite-code" data-testid="invite-code">
            {group.inviteCode}
          </code>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(group.inviteCode);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 3000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </section>

      <section aria-labelledby="removed-heading">
        <h2 id="removed-heading" className="section-title">
          Removed members
        </h2>
        {removed.length === 0 ? (
          <p className="muted">Nobody has been removed.</p>
        ) : (
          <ul className="member-list">
            {removed.map((m) => (
              <li key={m.id} className="member-row">
                <span>{m.name} (removed)</span>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void restore(m)} disabled={busy}>
                  Restore<span className="visually-hidden"> {m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="leave-heading">
        <h2 id="leave-heading" className="section-title">
          Leave group
        </h2>
        <button type="button" className="btn btn-danger-outline" onClick={() => setPending({ kind: 'leave' })}>
          Leave group
        </button>
      </section>

      <ConfirmDialog
        open={pending?.kind === 'remove'}
        title={pending?.kind === 'remove' ? `Remove ${pending.member.name}?` : ''}
        confirmLabel="Remove member"
        danger
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      >
        <p>They stay on past bills as “(removed)”. Any member can restore them later.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === 'leave'}
        title={group.iAmLastAccount ? 'Leave and delete this group?' : 'Leave this group?'}
        confirmLabel={group.iAmLastAccount ? 'Leave' : 'Leave group'}
        cancelLabel={group.iAmLastAccount ? 'Cancel' : 'Stay'}
        danger
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      >
        <p>{group.iAmLastAccount ? MESSAGES.lastAccountWarning : 'You can rejoin later with the invite code.'}</p>
      </ConfirmDialog>
    </div>
  );
}

function ActivityTab({ groupId }: { groupId: string }) {
  const { data, error, loading } = useLoad(() => api.get<{ activity: ActivityDto[] }>(`/groups/${groupId}/activity`), [groupId]);
  if (loading) return <Skeleton lines={4} />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data || data.activity.length === 0) return <EmptyState text="No activity yet. Every change to the group will be listed here." />;
  return (
    <ol className="activity-list">
      {data.activity.map((a) => (
        <li key={a.id} className="activity-row" data-testid="activity">
          <span>{a.message}</span>
          <time className="muted small" dateTime={a.at}>
            {niceDateTime(a.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
