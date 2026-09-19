import { describe, expect, it } from "vitest";
import type { EngineStatus } from "./api";
import { isEngineBusy, nextScanLabel, scanNowView } from "./scanNow";
import { usMarketOpen } from "./time";

const OPEN = new Date("2026-09-16T15:00:00+00:00");   // Wed 11:00 AM New York
const CLOSED = new Date("2026-09-19T15:00:00+00:00"); // Saturday

function status(over: Partial<EngineStatus> = {}): EngineStatus {
  return { running: true, state: "idle", engine_enabled: true, mode: "manual", market_hours_only: false, ...over };
}

describe("usMarketOpen", () => {
  it("is open during the regular session on a weekday", () => {
    expect(usMarketOpen(OPEN)).toBe(true);
    expect(usMarketOpen(new Date("2026-09-16T13:30:00+00:00"))).toBe(true);  // 9:30 AM EDT
  });

  it("is closed before the open, at the close, and at weekends", () => {
    expect(usMarketOpen(new Date("2026-09-16T13:29:00+00:00"))).toBe(false);
    expect(usMarketOpen(new Date("2026-09-16T20:00:00+00:00"))).toBe(false);  // 4:00 PM EDT
    expect(usMarketOpen(CLOSED)).toBe(false);
  });

  it("follows US daylight saving", () => {
    expect(usMarketOpen(new Date("2026-01-14T14:35:00+00:00"))).toBe(true);   // 9:35 AM EST
    expect(usMarketOpen(new Date("2026-01-14T14:25:00+00:00"))).toBe(false);  // 9:25 AM EST
  });
});

describe("scanNowView", () => {
  it("is ready when the engine is idle, even if its switch is off", () => {
    expect(scanNowView(status({ engine_enabled: false, state: "disabled" }), false, OPEN)).toEqual(
      { label: "Scan now", disabled: false, hint: null });
  });

  it("warns, but still allows a scan, when the US market is closed", () => {
    const v = scanNowView(status(), false, CLOSED);
    expect(v.disabled).toBe(false);
    expect(v.hint).toBe("US market is closed, so many tickers will have no option data.");
  });

  it("stops a scan outside market hours when the setting limits scans to US hours", () => {
    expect(scanNowView(status({ market_hours_only: true }), false, CLOSED)).toEqual({
      label: "Scan now",
      disabled: true,
      hint: 'US market is closed and "Only scan during US market hours" is on. Turn that off in Settings to scan anyway.',
    });
  });

  it("stays ready inside market hours even when the setting limits scans to US hours", () => {
    expect(scanNowView(status({ market_hours_only: true }), false, OPEN)).toEqual(
      { label: "Scan now", disabled: false, hint: null });
  });

  it("shows progress while the request is on its way", () => {
    expect(scanNowView(status(), true, OPEN)).toEqual({ label: "Starting scan…", disabled: true, hint: null });
  });

  it("is busy while a cycle or edge build is running", () => {
    expect(scanNowView(status({ state: "scanning" }), false, OPEN)).toEqual({ label: "Scanning…", disabled: true, hint: null });
    expect(scanNowView(status({ state: "building edge table" }), false, OPEN).label).toBe("Building edge table…");
  });

  it("explains why it can't scan when the engine thread isn't running", () => {
    const expected = { label: "Scan now", disabled: true, hint: "The engine isn't running. Start the app with ./run.sh." };
    expect(scanNowView(null, false, OPEN)).toEqual(expected);
    expect(scanNowView(status({ running: false, state: "not started" }), false, OPEN)).toEqual(expected);
  });
});

describe("isEngineBusy", () => {
  it("is true while a cycle or edge build is running", () => {
    expect(isEngineBusy("scanning")).toBe(true);
    expect(isEngineBusy("building edge table")).toBe(true);
  });

  it("is false otherwise", () => {
    for (const s of ["idle", "disabled", "market closed", "error", "not started", undefined, null]) {
      expect(isEngineBusy(s)).toBe(false);
    }
  });
});

describe("nextScanLabel", () => {
  const SG = "Asia/Singapore";
  const now = new Date("2026-09-16T15:00:00+00:00"); // 11:00 PM in Singapore

  it("shows the next scheduled scan in local 12-hour time", () => {
    expect(nextScanLabel(status({ next_scan_at: "2026-09-16T15:15:00+00:00" }), now, SG)).toBe("Next scan 11:15 PM");
  });

  it("includes the date when the next scan is not today", () => {
    expect(nextScanLabel(status({ next_scan_at: "2026-09-21T13:30:00+00:00" }), now, SG)).toBe("Next scan Sep 21, 9:30 PM");
  });

  it("says so while a scan is running", () => {
    expect(nextScanLabel(status({ state: "scanning", next_scan_at: null }), now, SG)).toBe("Scanning now");
  });

  it("says nothing is scheduled while the engine is off", () => {
    expect(nextScanLabel(status({ engine_enabled: false, next_scan_at: null }), now, SG)).toBe("No scan scheduled (engine off)");
  });

  it("shows a dash when the time isn't known yet", () => {
    expect(nextScanLabel(status({ next_scan_at: null }), now, SG)).toBe("Next scan —");
  });

  it("is hidden when the engine thread isn't running", () => {
    expect(nextScanLabel(null, now, SG)).toBeNull();
    expect(nextScanLabel(status({ running: false }), now, SG)).toBeNull();
  });
});
