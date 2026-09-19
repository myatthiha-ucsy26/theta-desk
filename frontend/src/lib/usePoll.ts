// Fetch now, then every intervalMs while the tab is visible. Keeps the last good data on error.
import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function usePoll<T>(load: () => Promise<T>, intervalMs: number): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}
