import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MESSAGES } from '../shared/rules.js';
import { ApiError } from './api.js';
import { focusFirstError, scrollBehavior } from './billEditor.js';

/**
 * Runs one save at a time. While busy, more clicks do nothing, so a
 * double-click never saves twice. A handler that navigates away after saving
 * returns 'leaving', and the page stays busy until it's gone.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async (fn: () => Promise<void | 'leaving'>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let leaving = false;
    try {
      leaving = (await fn()) === 'leaving';
    } finally {
      // A save that moves on to another page stays busy until this page is gone,
      // so a second click in between can't save twice.
      if (!leaving) {
        running.current = false;
        setBusy(false);
      }
    }
  }, []);
  return { busy, run };
}

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Reloaders of pages that show bills, payments or balances (see announceChange). */
const reloaders = new Set<() => void>();

/**
 * A save or delete finished after the person had already left its page (say,
 * Back while it was still going): whatever they're looking at now reloads, so
 * it includes the change.
 */
export function announceChange(): void {
  for (const reload of reloaders) reload();
}

/**
 * The corner message for a change that failed after its page was left, where its
 * own message would never be seen, e.g. "Bill not saved. Check your connection."
 */
export function failedAfterLeaving(what: string, err: unknown): string {
  const e = err instanceof ApiError ? err : new ApiError(0, MESSAGES.offline);
  let reason: string;
  if (e.offline || e.message === MESSAGES.offline) reason = 'Check your connection.';
  else if (e.code === 'DB_DOWN') reason = "The app can't reach its database. Try again in a moment.";
  else reason = Object.values(e.fields)[0] ?? e.message;
  return `${what} ${reason}`;
}

/**
 * Whether the person is still on this page: it's on screen, and the browser is
 * still at its own history entry. (A link click moves the address a moment
 * before the page is taken off screen.) False once they've left, e.g. while a
 * save was still going.
 */
export function useStillHere(): { readonly current: boolean } {
  const mounted = useRef(true);
  const { key } = useLocation();
  const entry = useRef(key);
  entry.current = key;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useMemo(
    () => ({
      get current() {
        // React Router keeps each entry's key in history.state ("default" for the first page loaded).
        const onEntry = ((window.history.state as { key?: string } | null)?.key ?? 'default') === entry.current;
        return mounted.current && onEntry;
      },
    }),
    [],
  );
}

/**
 * Loads data for a page and lets it reload after changes. With reloadOnChange,
 * the page also reloads when a change finishes after its page was left
 * (announceChange), so it never shows a list from before that change.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], opts: { reloadOnChange?: boolean } = {}): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const result = await loadRef.current();
      if (mine !== generation.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof ApiError ? err : new ApiError(0, 'Something went wrong'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setData(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reloadOnChange = opts.reloadOnChange ?? false;
  useEffect(() => {
    if (!reloadOnChange) return;
    const onChange = () => void reload();
    reloaders.add(onChange);
    return () => {
      reloaders.delete(onChange);
    };
  }, [reloadOnChange, reload]);

  return { data, error, loading, reload };
}

/**
 * Moves the cursor to the first field with a message, once the messages are on
 * screen. Use it after an await (e.g. the server rejected a field), when the new
 * messages are drawn later than a plain setTimeout would run.
 */
export function useFocusFirstError(root: RefObject<HTMLElement | null>): () => void {
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if (requests > 0) focusFirstError(root.current);
  }, [requests, root]);
  return useCallback(() => setRequests((n) => n + 1), []);
}

/** A list's "New" link passes this, so saving that bill can go back to the same list page. */
export const FROM_LIST = { fromList: true } as const;

/** This page was opened from a link that passed FROM_LIST, so it can go Back there when done. */
export function useFromList(): boolean {
  const location = useLocation();
  return Boolean((location.state as { fromList?: boolean } | null)?.fromList);
}

/** A bill saved on a page that went Back to its list (history state can't carry it there). */
let justSaved: { path: string; id: string; at: number } | null = null;

/** A bill was just saved and its editor went Back to this list path, which should show it. */
export function savedBillPending(path: string): boolean {
  return justSaved !== null && justSaved.path === path && Date.now() - justSaved.at < 10_000;
}

/**
 * After saving a bill: show its list with the bill marked "Saved". A bill opened
 * from that list goes back to it, so Back afterwards doesn't show the list twice;
 * otherwise the list replaces the editor in history.
 */
export function useShowSavedBill(): (listPath: string, billId: string) => void {
  const navigate = useNavigate();
  const fromList = useFromList();
  const here = useStillHere();
  return (listPath, billId) => {
    // If the person left while the save was still going, they've moved on: stay
    // put, and let the page they're on reload to include the bill.
    if (!here.current) {
      announceChange();
      return;
    }
    if (fromList) {
      justSaved = { path: listPath, id: billId, at: Date.now() };
      void navigate(-1);
    } else {
      void navigate(listPath, { replace: true, state: { savedBillId: billId } });
    }
  };
}

/**
 * On a bill list: the bill just saved, marked "Saved" and scrolled into view once
 * the list has loaded. The mark is then cleared from history, so going back to
 * the list or reloading doesn't show it again.
 */
export function useSavedBill(loaded: boolean): { savedId: string | undefined; rowRef: RefObject<HTMLAnchorElement | null> } {
  const location = useLocation();
  const navigate = useNavigate();
  const [savedId] = useState(() => {
    const fromState = (location.state as { savedBillId?: string } | null)?.savedBillId;
    const wentBack = savedBillPending(location.pathname) ? justSaved?.id : undefined;
    return fromState ?? wentBack;
  });
  const rowRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    justSaved = null;
    if ((location.state as { savedBillId?: string } | null)?.savedBillId) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (loaded && savedId) rowRef.current?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }, [loaded, savedId]);
  return { savedId, rowRef };
}
