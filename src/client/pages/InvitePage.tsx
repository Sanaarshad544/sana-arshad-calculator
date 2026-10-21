import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Account, InviteInfo, InviteResult } from '../../shared/api.js';
import { checkPassword, checkUsername } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { withoutKey } from '../fieldErrors.js';
import { useBusy, useLoad } from '../hooks.js';
import { useSession } from '../session.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useToast } from '../components/Toasts.js';
import { Logo } from '../components/Layout.js';
import { Alert, PasswordField, Skeleton, TextField, usePageTitle } from '../components/ui.js';
import { RecoveryCodeScreen } from './AuthPages.js';

const listOf = (names: string[]) => names.join(', ');

/** "You joined 2 groups.", plus any group that was skipped or where they stay removed. */
function joinedMessage(result: InviteResult | null): string {
  if (!result) return '';
  const n = result.joined.length;
  const parts = [n === 0 ? 'Your account is linked.' : `You joined ${n} group${n === 1 ? '' : 's'}.`];
  if (result.alreadyIn.length > 0) {
    parts.push(`You were already in ${listOf(result.alreadyIn)}, so ${result.alreadyIn.length === 1 ? 'it was' : 'they were'} skipped.`);
  }
  if (result.removed.length > 0) parts.push(`In ${listOf(result.removed)} you stay removed until a member restores you.`);
  return parts.join(' ');
}

/**
 * A personal invite link: /invite/<code>. Logged out, the person creates an
 * account or logs in; logged in, one button joins. Either way every group the
 * person is in is linked at once. Nobody picks a name from a list.
 */
export function InvitePage() {
  const { code = '' } = useParams();
  const path = `/invites/${encodeURIComponent(code)}`;
  const navigate = useNavigate();
  const toast = useToast();
  const { account, setAccount } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.get<{ invite: InviteInfo }>(path).then((r) => r.invite), [path]);
  usePageTitle(data && !data.used ? `Invite for ${data.name}` : 'Invite');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Right after signing up here: the recovery code to save, then what the invite did.
  const [signedUp, setSignedUp] = useState<{ recoveryCode: string; result: InviteResult | null } | null>(null);
  const { busy, run } = useBusy();
  // After logging in here without joining, the page changes under the cursor: move it to the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  useEffect(() => {
    if (focusHeading.current && heading.current) {
      focusHeading.current = false;
      heading.current.focus();
    }
  });

  const finish = (result: InviteResult | null) => {
    toast(joinedMessage(result));
    navigate('/', { replace: true });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (mode === 'signup') {
      const u = checkUsername(username);
      const p = checkPassword(password);
      const local: Record<string, string> = {};
      if (!u.ok) local.username = u.message;
      if (!p.ok) local.password = p.message;
      setFields(local);
      if (!u.ok || !p.ok) return;
    }
    void run(async () => {
      try {
        if (mode === 'signup') {
          const r = await api.post<{ account: Account; recoveryCode: string; invite: InviteResult | null }>('/auth/signup', {
            username,
            password,
            inviteCode: code,
          });
          // The groups are already linked; the recovery code is shown first.
          setSignedUp({ recoveryCode: r.recoveryCode, result: r.invite });
          setAccount(r.account);
        } else {
          const r = await api.post<{ account: Account; invite: InviteResult | null; inviteError: string | null; inviteConfirm: boolean }>(
            '/auth/login',
            { username, password, inviteCode: code },
          );
          setAccount(r.account);
          if (r.inviteError) {
            // Logged in, but the invite couldn't be used: say why, on the page as it now looks.
            setFormError(r.inviteError);
            focusHeading.current = true;
            await reload();
          } else if (r.inviteConfirm) {
            // Already in some of these groups: nothing is joined until they confirm on the page.
            focusHeading.current = true;
            await reload();
          } else {
            finish(r.invite);
          }
        }
      } catch (err) {
        const apiErr = err as ApiError;
        setFields(apiErr.fields);
        if (!Object.keys(apiErr.fields).length || apiErr.fields.inviteCode) setFormError(apiErr.message);
        // The invite was used or changed meanwhile: show the page as it is now.
        if (apiErr.fields.inviteCode) await reload();
      }
    });
  };

  const switchMode = (next: 'signup' | 'login') => {
    setMode(next);
    setFields({});
    setFormError('');
  };

  const acceptAsMe = () =>
    run(async () => {
      setConfirming(false);
      try {
        const r = await api.post<{ result: InviteResult }>(`${path}/accept`);
        finish(r.result);
      } catch (err) {
        setFormError((err as ApiError).message);
      }
    });

  const backLinks = account ? (
    <p className="muted">
      <Link to="/">Go to your Dashboard</Link>
    </p>
  ) : (
    <p className="muted">
      <Link to="/login">Log in</Link> or <Link to="/">go to Bill Splitter</Link>
    </p>
  );

  let body;
  if (loading || account === undefined) {
    body = <Skeleton lines={4} />;
  } else if (signedUp) {
    body = <RecoveryCodeScreen code={signedUp.recoveryCode} onDone={() => finish(signedUp.result)} />;
  } else if (error || !data) {
    body = (
      <div className="stack">
        <h1 tabIndex={-1} className="page-title">
          Invite not found
        </h1>
        <Alert>{error?.message}</Alert>
        <p className="muted">
          <Link to="/">Go to Bill Splitter</Link>
        </p>
      </div>
    );
  } else if (data.used) {
    body = (
      <div className="stack">
        <h1 tabIndex={-1} className="page-title">
          Invite already used
        </h1>
        <Alert>This invite has already been used</Alert>
        {backLinks}
      </div>
    );
  } else {
    const alsoIn = account ? data.viewerGroups : [];
    body = (
      <div className="stack">
        <h1 tabIndex={-1} className="page-title" ref={heading}>
          {data.name}, join your friends' groups
        </h1>
        <div>
          <p className="muted">You're in:</p>
          <ul className="invite-groups">
            {data.groups.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
        {account && data.viewerAlreadyIn ? (
          <>
            <Alert tone="info">
              You're already in {data.groups.length === 1 ? 'this group' : 'these groups'} as <strong>{account.username}</strong>. This invite
              is for {data.name}: send them the link so they can join.
            </Alert>
            {backLinks}
          </>
        ) : account ? (
          <>
            <Alert>{formError}</Alert>
            <p>
              You're logged in as <strong>{account.username}</strong>. Joining links these groups to this account.
            </p>
            {alsoIn.length > 0 && (
              <p className="callout invite-warning">
                You're already in {listOf(alsoIn)}. If you're not {data.name}, don't join: send them this link instead.
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary btn-wide"
              onClick={() => (alsoIn.length > 0 ? setConfirming(true) : void acceptAsMe())}
              disabled={busy}
            >
              {busy ? 'Joining…' : 'Join these groups'}
            </button>
            {alsoIn.length > 0 && (
              <ConfirmDialog
                open={confirming}
                title={`Join as ${data.name}?`}
                confirmLabel={`Join as ${data.name}`}
                busy={busy}
                onConfirm={() => void acceptAsMe()}
                onCancel={() => setConfirming(false)}
              >
                <p>
                  {account.username} is already in {listOf(alsoIn)}. Joining links {data.name}'s other groups to this account and uses up the
                  invite. Only continue if you're {data.name}.
                </p>
              </ConfirmDialog>
            )}
          </>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            <div className="segmented segmented-wide" role="radiogroup" aria-label="Do you have an account?">
              <label className={mode === 'signup' ? 'seg seg-on' : 'seg'}>
                <input type="radio" name="invite-mode" checked={mode === 'signup'} onChange={() => switchMode('signup')} />
                <span>I'm new here</span>
              </label>
              <label className={mode === 'login' ? 'seg seg-on' : 'seg'}>
                <input type="radio" name="invite-mode" checked={mode === 'login'} onChange={() => switchMode('login')} />
                <span>I have an account</span>
              </label>
            </div>
            <Alert>{formError}</Alert>
            <TextField
              label="Username"
              hint={mode === 'signup' ? '3 to 30 English letters, numbers or underscores, like omar_99' : undefined}
              value={username}
              onChange={(v) => {
                setUsername(v);
                setFields((f) => withoutKey(f, 'username'));
              }}
              error={fields.username}
              autoComplete="username"
              autoCapitalize="none"
            />
            <PasswordField
              label="Password"
              hint={mode === 'signup' ? 'At least 8 characters' : undefined}
              value={password}
              onChange={(v) => {
                setPassword(v);
                setFields((f) => withoutKey(f, 'password'));
              }}
              error={fields.password}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
            <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
              {busy ? 'Joining…' : mode === 'signup' ? 'Create account and join' : 'Log in and join'}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <main id="main" className="public public-single">
      <div className="public-card">
        <div className="brand">
          <Logo />
          <span>Bill Splitter</span>
        </div>
        {body}
      </div>
    </main>
  );
}
