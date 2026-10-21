import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Account } from '../../shared/api.js';
import { checkPassword, checkUsername } from '../../shared/rules.js';
import { ApiError, api } from '../api.js';
import { withoutKey } from '../fieldErrors.js';
import { useBusy } from '../hooks.js';
import { useSession } from '../session.js';
import { Alert, PasswordField, TextField, usePageTitle } from '../components/ui.js';

/** Shown once after sign-up or reset. Leaving this screen means it's gone for good. */
export function RecoveryCodeScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack">
      <h1 tabIndex={-1} className="page-title">
        Save your recovery code
      </h1>
      <Alert tone="info">
        <strong>Save this now.</strong> It's the only way to reset your password if you forget it, and it will never be shown again.
      </Alert>
      <p className="recovery-code" data-testid="recovery-code">
        {code}
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          I've saved it, continue
        </button>
      </div>
    </div>
  );
}

export function LoginPage() {
  usePageTitle('Log in');
  const { setAccount } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        const r = await api.post<{ account: Account }>('/auth/login', { username, password });
        setError('');
        setAccount(r.account);
      } catch (err) {
        setError((err as ApiError).message);
      }
    });
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1 tabIndex={-1} className="page-title">
        Log in
      </h1>
      <Alert>{error}</Alert>
      <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" autoCapitalize="none" />
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <p className="muted">
        <Link to="/reset">Forgot your password?</Link>
      </p>
      <p className="muted">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </form>
  );
}

export function SignupPage() {
  usePageTitle('Create an account');
  const { setAccount, recoveryCode, setRecoveryCode } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  if (recoveryCode) {
    return (
      <RecoveryCodeScreen
        code={recoveryCode}
        onDone={() => {
          setRecoveryCode(null);
          navigate('/', { replace: true });
        }}
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = checkUsername(username);
    const p = checkPassword(password);
    const local: Record<string, string> = {};
    if (!u.ok) local.username = u.message;
    if (!p.ok) local.password = p.message;
    setErrors(local);
    setError('');
    if (!u.ok || !p.ok) return;
    void run(async () => {
      try {
        const r = await api.post<{ account: Account; recoveryCode: string }>('/auth/signup', { username, password });
        setRecoveryCode(r.recoveryCode);
        setAccount(r.account);
      } catch (err) {
        const apiErr = err as ApiError;
        setErrors(apiErr.fields);
        if (Object.keys(apiErr.fields).length === 0) setError(apiErr.message);
      }
    });
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1 tabIndex={-1} className="page-title">
        Create an account
      </h1>
      <p className="muted">No email or phone number needed.</p>
      <Alert>{error}</Alert>
      <TextField
        label="Username"
        hint="3 to 30 English letters, numbers or underscores, like omar_99"
        value={username}
        onChange={(v) => {
          setUsername(v);
          setErrors((e) => withoutKey(e, 'username'));
        }}
        error={errors.username}
        autoComplete="username"
        autoCapitalize="none"
      />
      <PasswordField
        label="Password"
        hint="At least 8 characters"
        value={password}
        onChange={(v) => {
          setPassword(v);
          setErrors((e) => withoutKey(e, 'password'));
        }}
        error={errors.password}
        autoComplete="new-password"
      />
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}

export function ResetPage() {
  usePageTitle('Reset your password');
  const { setAccount, recoveryCode, setRecoveryCode } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  if (recoveryCode) {
    return (
      <RecoveryCodeScreen
        code={recoveryCode}
        onDone={() => {
          setRecoveryCode(null);
          navigate('/', { replace: true });
        }}
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = checkPassword(password);
    setErrors(p.ok ? {} : { newPassword: p.message });
    setError('');
    if (!p.ok) return;
    void run(async () => {
      try {
        const r = await api.post<{ account: Account; recoveryCode: string }>('/auth/reset', {
          username,
          recoveryCode: code,
          newPassword: password,
        });
        setRecoveryCode(r.recoveryCode);
        setAccount(r.account);
      } catch (err) {
        const apiErr = err as ApiError;
        setErrors(apiErr.fields);
        if (Object.keys(apiErr.fields).length === 0) setError(apiErr.message);
      }
    });
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1 tabIndex={-1} className="page-title">
        Reset your password
      </h1>
      <p className="muted">Use the recovery code you saved when you created your account.</p>
      <Alert>{error}</Alert>
      <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" autoCapitalize="none" />
      <TextField label="Recovery code" value={code} onChange={setCode} autoComplete="off" autoCapitalize="characters" />
      <PasswordField
        label="New password"
        hint="At least 8 characters"
        value={password}
        onChange={(v) => {
          setPassword(v);
          setErrors((e) => withoutKey(e, 'newPassword'));
        }}
        error={errors.newPassword}
        autoComplete="new-password"
      />
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
        {busy ? 'Resetting…' : 'Reset password'}
      </button>
      <p className="muted">
        <Link to="/login">Back to log in</Link>
      </p>
    </form>
  );
}
