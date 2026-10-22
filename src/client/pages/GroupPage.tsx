import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActivityDto, GroupBillSummary, GroupDetail, MemberDto, PersonOption, SettleUpDto } from '../../shared/api.js';
import { centsToInput } from '../../shared/money.js';
import { MESSAGES, checkMemberName, inviteCodeGroups } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { FROM_LIST, announceChange, failedAfterLeaving, savedBillPending, useBusy, useLoad, useSavedBill, useStillHere } from '../hooks.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CurrencyNote } from '../components/CurrencyNote.js';
import { useToast } from '../components/Toasts.js';
import { Alert, Balance, EmptyState, ErrorText, PageHeader, Skeleton, TextField, money, niceDate, niceDateTime, usePageTitle } from '../components/ui.js';

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
    { reloadOnChange: true },
  );
  usePageTitle(data?.name ?? 'Group');
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  // Back here from a bill just saved: show it on the Bills tab, whichever tab was open before.
  const [cameBackSaved, setCameBackSaved] = useState(() => savedBillPending(location.pathname));
  const askedTab = cameBackSaved ? null : params.get('tab');
  const tab = (TABS.find((t) => t.id === askedTab)?.id ?? 'bills') as TabId;
  useEffect(() => {
    if (!cameBackSaved) return;
    if (params.get('tab')) setParams({}, { replace: true });
    setCameBackSaved(false);
    // Once, on arrival; after that the tabs work as usual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        <Link className="btn btn-secondary" to={`/groups/${group.id}/edit`} state={FROM_LIST}>
          Edit group
        </Link>
        <Link className="btn btn-primary" to={`/groups/${group.id}/bills/new`} state={FROM_LIST}>
          Add bill
        </Link>
      </PageHeader>
      <CurrencyNote currency={group.currency} className="page-meta" />

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
                    state={FROM_LIST}
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
  const { data, error, loading } = useLoad(() => api.get<{ bills: GroupBillSummary[] }>(`/groups/${group.id}/bills`), [group.id], {
    reloadOnChange: true,
  });
  const { savedId, rowRef } = useSavedBill(data !== null);
  if (loading) return <Skeleton lines={3} />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data || data.bills.length === 0) {
    return <EmptyState text="No bills yet. Add the first bill you shared." action={{ to: `/groups/${group.id}/bills/new`, label: 'Add bill', state: FROM_LIST }} />;
  }
  return (
    <ul className="link-list">
      {data.bills.map((b) => (
        <li key={b.id}>
          <Link
            to={`/groups/${group.id}/bills/${b.id}`}
            state={FROM_LIST}
            className={b.id === savedId ? 'link-row link-row-saved' : 'link-row'}
            ref={b.id === savedId ? rowRef : undefined}
          >
            <span className="link-row-title">
              {b.name}
              {b.id === savedId && <>{' '}<span className="badge badge-saved">Saved</span></>}
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
  const { data, error, loading } = useLoad(() => api.get<{ settleUps: SettleUpDto[] }>(`/groups/${group.id}/settle-ups`), [group.id], {
    reloadOnChange: true,
  });
  if (loading) return <Skeleton lines={3} />;
  if (error) return <Alert>{error.message}</Alert>;
  return (
    <div className="stack">
      <div>
        <Link className="btn btn-secondary" to={`/groups/${group.id}/settle-ups/new`} state={FROM_LIST}>
          Record a payment
        </Link>
      </div>
      {!data || data.settleUps.length === 0 ? (
        <EmptyState text="No settle-ups yet. When someone pays another member back, record it here so balances stay right." />
      ) : (
        <ul className="link-list">
          {data.settleUps.map((s) => (
            <li key={s.id}>
              <Link to={`/groups/${group.id}/settle-ups/${s.id}`} state={FROM_LIST} className="link-row">
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

function inviteLink(code: string): string {
  return `${window.location.origin}/invite/${code}`;
}

/** The code in groups of four, so it's easy to read out. Copying it gives the plain code. */
function InviteCode({ code, testId }: { code: string; testId: string }) {
  return (
    <code className="invite-code-inline" data-testid={testId}>
      {inviteCodeGroups(code).map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </code>
  );
}

/** Code, Copy link and Share for one person who hasn't joined yet. */
function InviteControls({ member }: { member: MemberDto }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!member.inviteCode) return null;
  const link = inviteLink(member.inviteCode);
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="invite-row">
      <span className="muted small">
        Invite code <InviteCode code={member.inviteCode} testId={`invite-code-${member.name}`} />
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopyFailed(false);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 3000);
          } catch {
            // No clipboard here (for example over plain http on a home network): show the link to copy by hand.
            setCopied(false);
            setCopyFailed(true);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
        <span className="visually-hidden"> for {member.name}</span>
      </button>
      {canShare && (
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => {
            navigator.share({ title: 'Bill Splitter', text: `${member.name}, join our groups on Bill Splitter`, url: link }).catch(() => {});
          }}
        >
          Share<span className="visually-hidden"> invite for {member.name}</span>
        </button>
      )}
      {copyFailed && (
        <TextField
          className="invite-link-field"
          label={`Invite link for ${member.name}`}
          hint="Copying didn't work here. Select the link and copy it."
          value={link}
          onChange={() => {}}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}

/** How a member who hasn't joined is shown: their invite, or why there's none to send. */
function joinStatus(m: MemberDto): string {
  if (m.hasAccount) return 'has an account';
  if (m.inviteNote === 'joined') return m.alsoHereAs ? `already here as ${m.alsoHereAs}` : 'joined under another name';
  return 'not joined yet';
}

type JustAdded = { id: string; invite: 'new' | 'changed' | 'covered' };

const ADDED_TEXT: Record<JustAdded['invite'], string> = {
  new: "Send them their own invite link so they can join with an account. It links every group they're in at once.",
  changed: "Their invite link has changed, so send them this new one. It links every group they're in at once.",
  covered: 'Their invite link now covers this group too.',
};

function MembersTab({ group, reload }: { group: GroupDetail; reload: () => Promise<void> }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [personKey, setPersonKey] = useState('');
  const [personError, setPersonError] = useState('');
  // Shown when their usual name is already used in this group.
  const [personName, setPersonName] = useState<string | null>(null);
  const [personNameError, setPersonNameError] = useState('');
  const [justAdded, setJustAdded] = useState<JustAdded | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const { busy, run } = useBusy();
  const here = useStillHere();
  const people = useLoad(() => api.get<{ people: PersonOption[] }>(`/people?groupId=${group.id}`).then((r) => r.people), [group.id]);
  const current = group.members.filter((m) => m.status === 'current');
  const removed = group.members.filter((m) => m.status === 'removed');
  const added = justAdded ? group.members.find((m) => m.id === justAdded.id) : undefined;
  // After adding someone from my other groups, the cursor moves to their "Invite" box.
  const inviteBoxTitle = useRef<HTMLHeadingElement>(null);
  const focusBoxFor = useRef<string | null>(null);
  useEffect(() => {
    if (!added || focusBoxFor.current !== added.id) return;
    focusBoxFor.current = null;
    if (added.inviteCode) inviteBoxTitle.current?.focus();
  });

  const afterAdd = async (next: JustAdded) => {
    toast('Member added');
    setJustAdded(next);
    // The list of people to add is refreshed without being cleared, so the form stays put.
    await Promise.all([reload(), people.reload()]);
  };

  const addMember = (e: FormEvent) => {
    e.preventDefault();
    const check = checkMemberName(newName);
    if (!check.ok) {
      setNameError(check.message);
      return;
    }
    void run(async () => {
      try {
        const r = await api.post<{ memberId: string }>(`/groups/${group.id}/members`, { name: newName });
        setNewName('');
        setNameError('');
        await afterAdd({ id: r.memberId, invite: 'new' });
      } catch (err) {
        const e2 = err as ApiError;
        setNameError(e2.fields.name ?? e2.message);
      }
    });
  };

  const addPerson = (e: FormEvent) => {
    e.preventDefault();
    if (!personKey) {
      setPersonError('Choose someone to add');
      return;
    }
    if (personName !== null) {
      const check = checkMemberName(personName);
      if (!check.ok) {
        setPersonNameError(check.message);
        return;
      }
    }
    void run(async () => {
      try {
        const body = personName === null ? { personKey } : { personKey, name: personName };
        const r = await api.post<{ memberId: string; inviteChanged: boolean }>(`/groups/${group.id}/members`, body);
        setPersonKey('');
        setPersonError('');
        setPersonName(null);
        setPersonNameError('');
        focusBoxFor.current = r.memberId;
        await afterAdd({ id: r.memberId, invite: r.inviteChanged ? 'changed' : 'covered' });
      } catch (err) {
        const e2 = err as ApiError;
        if (e2.status === 409 && e2.fields.name) {
          // Their usual name is taken here: ask for another one.
          setPersonName((n) => n ?? people.data?.find((p) => p.key === personKey)?.name ?? '');
          setPersonNameError(e2.fields.name);
        } else {
          setPersonError(e2.fields.person ?? e2.fields.name ?? e2.message);
        }
      }
    });
  };

  const focusRename = (memberId: string) => window.setTimeout(() => renameButtons.current.get(memberId)?.focus(), 0);
  const cancelRename = (memberId: string) => {
    setRenaming(null);
    setRenameError('');
    focusRename(memberId);
  };

  const saveRename = (member: MemberDto) =>
    run(async () => {
      const check = checkMemberName(renameValue);
      if (!check.ok) {
        setRenameError(check.message);
        return;
      }
      try {
        await api.put(`/groups/${group.id}/members/${member.id}`, { name: renameValue });
        setRenaming(null);
        setRenameError('');
        toast('Name changed');
        await reload();
        focusRename(member.id);
      } catch (err) {
        const e2 = err as ApiError;
        setRenameError(e2.fields.name ?? e2.message);
      }
    });

  const confirm = () =>
    run(async () => {
      if (!pending) return;
      setError('');
      try {
        if (pending.kind === 'remove') {
          await api.post(`/groups/${group.id}/members/${pending.member.id}/remove`);
          setPending(null);
          toast('Member removed');
          // Left the page meanwhile: the page they're on reloads instead.
          if (!here.current) return announceChange();
          await reload();
        } else {
          const r = await api.post<{ outcome: 'left' | 'deleted' }>(`/groups/${group.id}/leave`, { confirmDelete: group.iAmLastAccount });
          setPending(null);
          toast(r.outcome === 'deleted' ? 'Group deleted' : 'You left the group');
          // Only moved to another tab of this group meanwhile: still leave its page.
          const onGroupPage = window.location.pathname === `/groups/${group.id}`;
          if (!here.current && !onGroupPage) return announceChange();
          navigate('/groups', { replace: true });
          return 'leaving';
        }
      } catch (err) {
        if (!here.current) {
          const what = pending.kind === 'remove' ? `${pending.member.name} wasn't removed.` : "You haven't left the group.";
          return toast(failedAfterLeaving(what, err), 'error');
        }
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

  const renameControls = (m: MemberDto) =>
    renaming === m.id ? (
      <form
        className="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          void saveRename(m);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelRename(m.id);
          }
        }}
        noValidate
      >
        <TextField
          label={`New name for ${m.name}`}
          value={renameValue}
          onChange={(v) => {
            setRenameValue(v);
            setRenameError('');
          }}
          error={renameError}
          maxLength={200}
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          Save name
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => cancelRename(m.id)}>
          Cancel
        </button>
      </form>
    ) : (
      <button
        type="button"
        className="btn btn-ghost btn-small"
        ref={(el) => {
          renameButtons.current.set(m.id, el);
        }}
        onClick={() => {
          setRenaming(m.id);
          setRenameValue(m.name);
          setRenameError('');
        }}
      >
        Rename<span className="visually-hidden"> {m.name}</span>
      </button>
    );

  return (
    <div className="stack-lg">
      <Alert>{error}</Alert>
      {added?.inviteCode && justAdded && (
        <section className="callout invite-callout" aria-labelledby="invite-box-title">
          <h2 id="invite-box-title" className="callout-title" tabIndex={-1} ref={inviteBoxTitle}>
            Invite {added.name}
          </h2>
          <p>
            <strong>{added.name}</strong> was added. {ADDED_TEXT[justAdded.invite]}
          </p>
          <InviteControls member={added} />
        </section>
      )}
      <section aria-labelledby="current-heading">
        <h2 id="current-heading" className="section-title">
          Members ({current.length})
        </h2>
        <ul className="member-list">
          {current.map((m) => (
            <li key={m.id} className="member-row member-row-stack">
              <div className="member-main">
                <span className="person">
                  {m.name}
                  {m.isMe && <span className="muted"> (you)</span>}
                  <span className="muted small"> · {joinStatus(m)}</span>
                </span>
                <div className="member-actions">
                  {renameControls(m)}
                  {!m.isMe && (
                    <button type="button" className="btn btn-danger-outline btn-small" onClick={() => setPending({ kind: 'remove', member: m })}>
                      Remove<span className="visually-hidden"> {m.name}</span>
                    </button>
                  )}
                </div>
              </div>
              <InviteControls member={m} />
              {m.inviteNote === 'elsewhere' && (
                <p className="muted small invite-note">Only someone who's in all of {m.name}'s groups can send their invite.</p>
              )}
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={addMember} noValidate>
          <TextField
            label="Add a friend by name"
            value={newName}
            onChange={(v) => {
              setNewName(v);
              setNameError('');
            }}
            error={nameError}
            maxLength={200}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            Add member
          </button>
        </form>
        {people.data && people.data.length > 0 && (
          <form className="inline-form" onSubmit={addPerson} noValidate>
            <div className="field">
              <label htmlFor="add-person" className="field-label">
                Or add someone from your other groups
              </label>
              <select
                id="add-person"
                className="input select"
                value={personKey}
                onChange={(e) => {
                  setPersonKey(e.target.value);
                  setPersonError('');
                  setPersonName(null);
                  setPersonNameError('');
                }}
                aria-invalid={personError ? true : undefined}
                aria-describedby={personError ? 'add-person-error' : undefined}
              >
                <option value="">Choose a person</option>
                {people.data.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.groups.join(', ')})
                  </option>
                ))}
              </select>
              <ErrorText id="add-person-error">{personError}</ErrorText>
            </div>
            {personName !== null && (
              <TextField
                label="Name in this group"
                value={personName}
                onChange={(v) => {
                  setPersonName(v);
                  setPersonNameError('');
                }}
                error={personNameError}
                maxLength={200}
                autoFocus
              />
            )}
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Add to group
            </button>
          </form>
        )}
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
              <li key={m.id} className="member-row member-row-stack">
                <div className="member-main">
                  <span>{m.name} (removed)</span>
                  <div className="member-actions">
                    {renameControls(m)}
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => void restore(m)} disabled={busy}>
                      Restore<span className="visually-hidden"> {m.name}</span>
                    </button>
                  </div>
                </div>
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
        <p>{group.iAmLastAccount ? MESSAGES.lastAccountWarning : 'Any member can restore you later.'}</p>
      </ConfirmDialog>
    </div>
  );
}

function ActivityTab({ groupId }: { groupId: string }) {
  const { data, error, loading } = useLoad(() => api.get<{ activity: ActivityDto[] }>(`/groups/${groupId}/activity`), [groupId], {
    reloadOnChange: true,
  });
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
