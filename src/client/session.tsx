import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Account, Theme } from '../shared/api.js';
import { api, onLoggedOut } from './api.js';

interface SessionValue {
  /** undefined while checking, null when logged out. */
  account: Account | null | undefined;
  setAccount: (account: Account | null) => void;
  setTheme: (theme: Theme) => Promise<void>;
  logout: () => Promise<void>;
  /** A recovery code to show once, right after sign-up or reset. Kept only in memory. */
  recoveryCode: string | null;
  setRecoveryCode: (code: string | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Applies the appearance: "device" follows the device's light/dark setting. */
export function applyTheme(theme: Theme | undefined): void {
  const root = document.documentElement;
  if (!theme || theme === 'device') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Account | null | undefined>(undefined);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const setAccount = useCallback((next: Account | null) => {
    setAccountState(next);
    applyTheme(next?.theme);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<{ account: Account }>('/me')
      .then((r) => alive && setAccount(r.account))
      .catch(() => alive && setAccount(null));
    const off = onLoggedOut(() => setAccount(null));
    return () => {
      alive = false;
      off();
    };
  }, [setAccount]);

  const setTheme = useCallback(
    async (theme: Theme) => {
      const r = await api.put<{ account: Account }>('/me/theme', { theme });
      setAccount(r.account);
    },
    [setAccount],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setAccount(null);
  }, [setAccount]);

  const value = useMemo(
    () => ({ account, setAccount, setTheme, logout, recoveryCode, setRecoveryCode }),
    [account, setAccount, setTheme, logout, recoveryCode],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
