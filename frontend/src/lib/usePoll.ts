// Fetch now, then every intervalMs while the tab is visible. Keeps the last good data on error.
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO } from "./demo/flag";

const DEMO_POLL_MS = 3000;

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
    // The demo desk has no server to spare, so it refreshes every few seconds and its book ticks.
    const every = DEMO ? Math.min(intervalMs, DEMO_POLL_MS) : intervalMs;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, every);
    return () => window.clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}
