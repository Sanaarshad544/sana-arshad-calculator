import { useId, useState } from 'react';
import type { Theme } from '../../shared/api.js';
import { ApiError } from '../api.js';
import { useSession } from '../session.js';
import { Alert, PageHeader, usePageTitle } from '../components/ui.js';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'device', label: 'Device (follow my device)' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsPage() {
  usePageTitle('Settings');
  const { account, setTheme, logout } = useSession();
  const [error, setError] = useState('');
  const name = useId();
  if (!account) return null;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="stack-lg">
        <section className="card" aria-labelledby="acct-user">
          <h2 id="acct-user" className="section-title">
            Username
          </h2>
          <p data-testid="account-username">{account.username}</p>
        </section>
        <section className="card">
          <fieldset>
            <legend className="section-title">Appearance</legend>
            <Alert>{error}</Alert>
            <div className="radio-col">
              {THEMES.map((t) => (
                <label key={t.value} className="check">
                  <input
                    type="radio"
                    name={name}
                    checked={account.theme === t.value}
                    onChange={() => {
                      setError('');
                      setTheme(t.value).catch((e: ApiError) => setError(e.message));
                    }}
                  />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="card">
          <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
            Log out
          </button>
        </section>
      </div>
    </>
  );
}
