import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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

/** Loads data for a page and lets it reload after changes. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
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

/** A bill saved on a page that went Back to its list (history state can't carry it there). */
let justSaved: { path: string; id: string; at: number } | null = null;

/**
 * After saving a bill: show its list with the bill marked "Saved". A bill opened
 * from that list goes back to it, so Back afterwards doesn't show the list twice;
 * otherwise the list replaces the editor in history.
 */
export function useShowSavedBill(): (listPath: string, billId: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  // If the person left while the save was still going, they've moved on: stay put.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  return (listPath, billId) => {
    if (!open.current) return;
    if ((location.state as { fromList?: boolean } | null)?.fromList) {
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
    const wentBack = justSaved && justSaved.path === location.pathname && Date.now() - justSaved.at < 10_000 ? justSaved.id : undefined;
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
