/** A copy of a field-errors object without one field's message (that field was just edited). */
export function withoutKey<T extends Record<string, string>>(errors: T, key: string): T {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/**
 * Removes the message for an edited field. "items*" removes every message whose
 * key starts with "items" (items moved, so their numbers changed); "*.sharers"
 * removes every message whose key ends with ".sharers".
 */
export function clearFieldError<T extends Record<string, string>>(errors: T, key: string): T {
  if (key.endsWith('*')) {
    const prefix = key.slice(0, -1);
    return Object.fromEntries(Object.entries(errors).filter(([k]) => !k.startsWith(prefix))) as T;
  }
  if (key.startsWith('*')) {
    const suffix = key.slice(1);
    return Object.fromEntries(Object.entries(errors).filter(([k]) => !k.endsWith(suffix))) as T;
  }
  return withoutKey(errors, key);
}
