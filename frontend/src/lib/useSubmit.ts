import { useCallback, useState } from 'react';
import { ApiError } from '../api/client';

/** Wraps a mutating call with busy/error state. Returns the result, or undefined if it failed (error is kept in state). */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    setError(undefined);
    try {
      return { ok: true, value: await action() };
    } catch (e) {
      setError(e);
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }, []);
  const fieldError = (field: string) => (error instanceof ApiError ? error.fieldMessage(field) : undefined);
  return { busy, error, run, fieldError, clear: () => setError(undefined) };
}
