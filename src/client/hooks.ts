import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ApiError } from './api.js';
import { focusFirstError } from './billEditor.js';

/**
 * Runs one save at a time. While busy, more clicks do nothing, so a
 * double-click never saves twice.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      running.current = false;
      setBusy(false);
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
