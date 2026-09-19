// What the "Scan now" button shows, from engine status. Pure.
import type { EngineStatus } from "./api";
import { formatTime, usMarketOpen } from "./time";

export interface ScanNowView {
  label: string;
  disabled: boolean;
  hint: string | null;
}

const HOURS_HINT =
  'US market is closed and "Only scan during US market hours" is on. Turn that off in Settings to scan anyway.';

export function scanNowView(status: EngineStatus | null, pending: boolean, now: Date = new Date()): ScanNowView {
  if (!status || !status.running) {
    return { label: "Scan now", disabled: true, hint: "The engine isn't running. Start the app with ./run.sh." };
  }
  if (pending) return { label: "Starting scan…", disabled: true, hint: null };
  if (status.state === "scanning") return { label: "Scanning…", disabled: true, hint: null };
  if (status.state === "building edge table") return { label: "Building edge table…", disabled: true, hint: null };
  const open = usMarketOpen(now);
  // A manual scan overrides market hours server-side, so honour the setting here instead.
  if (status.market_hours_only && !open) return { label: "Scan now", disabled: true, hint: HOURS_HINT };
  return {
    label: "Scan now",
    disabled: false,
    hint: open ? null : "US market is closed, so many tickers will have no option data.",
  };
}

/** A cycle or an edge-table build is in progress; screens poll faster while this is true. */
export function isEngineBusy(state: string | null | undefined): boolean {
  return state === "scanning" || state === "building edge table";
}

/** "Next scan 10:30 PM" for the status bar; null hides it when there is no engine thread. */
export function nextScanLabel(status: EngineStatus | null, now: Date = new Date(), timeZone?: string): string | null {
  if (!status || !status.running) return null;
  if (isEngineBusy(status.state)) return "Scanning now";
  if (!status.engine_enabled) return "No scan scheduled (engine off)";
  if (!status.next_scan_at) return "Next scan —";
  return `Next scan ${formatTime(status.next_scan_at, now, timeZone)}`;
}
