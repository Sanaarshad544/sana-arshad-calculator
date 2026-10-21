// Talking to the server. Every failure becomes an ApiError with a message
// that can be shown to the user as it is.

import { MESSAGES } from '../shared/rules.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
    public code?: string,
  ) {
    super(message);
  }
  /** The server couldn't be reached at all. */
  get offline(): boolean {
    return this.status === 0;
  }
}

type Listener = () => void;
const loggedOutListeners = new Set<Listener>();

/** Called when the server says the session has ended. */
export function onLoggedOut(listener: Listener): () => void {
  loggedOutListeners.add(listener);
  return () => loggedOutListeners.delete(listener);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, MESSAGES.offline);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; fields?: Record<string, string>; code?: string } } | null)?.error;
    if (res.status === 401 && err?.code === 'NOT_LOGGED_IN') loggedOutListeners.forEach((l) => l());
    const message =
      err?.message ?? (res.status >= 500 ? MESSAGES.offline : 'Something went wrong. Please try again.');
    throw new ApiError(res.status, message, err?.fields ?? {}, err?.code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
