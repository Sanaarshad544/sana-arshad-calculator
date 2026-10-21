import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog.js';

/**
 * Asks before leaving a form with unsaved changes. Links and the back button
 * get our own question; closing or reloading the tab gets the browser's.
 * Call `allowLeave()` right before moving away after a save or delete.
 */
export function useUnsavedGuard(dirty: boolean) {
  const allowed = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (allowed.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const allowLeave = useCallback(() => {
    allowed.current = true;
  }, []);

  const dialog = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="You have unsaved changes. Leave without saving?"
      confirmLabel="Leave"
      cancelLabel="Stay"
      danger
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  );

  return { dialog, allowLeave };
}
