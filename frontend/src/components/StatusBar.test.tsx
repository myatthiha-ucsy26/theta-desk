import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engineStatus = vi.fn();
const saveSettings = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    engineStatus: () => engineStatus(),
    saveSettings: (updates: unknown) => saveSettings(updates),
    bot: () => Promise.reject(new Error("offline")),
  },
}));

import { StatusBar } from "./StatusBar";
import { announceSettingsSaved } from "../lib/settingsBus";
import { marketHours } from "../lib/time";

const LAST_CYCLE = "2026-09-16T22:15:00+00:00";
const SATURDAY = new Date("2026-09-19T15:00:00+00:00");

const online = {
  running: true, state: "idle", engine_enabled: true, market_hours_only: false, last_cycle: LAST_CYCLE,
};

beforeEach(() => {
  engineStatus.mockReset();
  saveSettings.mockReset();
});

afterEach(cleanup);

describe("StatusBar", () => {
  it("shows the engine state in words and the switch as on", async () => {
    engineStatus.mockResolvedValue(online);
    render(<StatusBar />);

    expect(await screen.findByText("Waiting for next cycle")).toBeDefined();
    expect(screen.getByRole("switch", { name: "Engine" }).getAttribute("aria-checked")).toBe("true");
  });

  it("says it is still checking instead of claiming the engine is off", () => {
    engineStatus.mockReturnValue(new Promise(() => {}));
    render(<StatusBar />);

    expect(screen.getByText("Checking engine…")).toBeDefined();
    expect(screen.queryByText("Engine not started")).toBeNull();
    expect(screen.queryByText(/engine off/)).toBeNull();
    const sw = screen.getByRole("switch", { name: "Engine" });
    expect(sw.getAttribute("aria-busy")).toBe("true");
    expect((sw as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the engine is unreachable when the first status never arrives", async () => {
    engineStatus.mockRejectedValue(new Error("Failed to fetch"));
    render(<StatusBar />);

    expect(await screen.findByText("Engine unreachable")).toBeDefined();
  });

  it("re-reads the engine status when a save elsewhere says it changed", async () => {
    engineStatus.mockResolvedValue(online);
    render(<StatusBar />);
    expect((await screen.findByRole("switch", { name: "Engine" })).getAttribute("aria-checked")).toBe("true");

    // Settings saves engine_enabled=false; the header must not wait out its 15s poll.
    engineStatus.mockResolvedValue({ ...online, engine_enabled: false });
    await act(async () => {
      announceSettingsSaved();
    });

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Engine" }).getAttribute("aria-checked")).toBe("false"),
    );
    expect(screen.getByText("No scan scheduled (engine off)")).toBeDefined();
  });

  it("shows the last cycle time and the market hours in local time", async () => {
    engineStatus.mockResolvedValue(online);
    render(<StatusBar />);

    expect(await screen.findByText(/^Last cycle /)).toBeDefined();
    // The scan hint can also start with "US market", so name the hours line exactly.
    const hours = marketHours();
    expect(screen.getByText(`US market ${hours.open}–${hours.close}`)).toBeDefined();
  });

  it("saves engine_enabled when the switch is clicked", async () => {
    engineStatus.mockResolvedValue(online);
    saveSettings.mockResolvedValue({ ...online, engine_enabled: false });
    render(<StatusBar />);

    const sw = await screen.findByRole("switch", { name: "Engine" });
    await act(async () => {
      fireEvent.click(sw);
    });

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ engine_enabled: false }));
  });

  it("shows the last error when there is one", async () => {
    engineStatus.mockResolvedValue({ ...online, state: "error", last_error: "OpenD not reachable" });
    render(<StatusBar />);

    expect(await screen.findByText("Last error: OpenD not reachable")).toBeDefined();
    expect((await screen.findAllByText("Error")).length).toBeGreaterThan(0);
  });

  it("shows the error message when saving the switch fails", async () => {
    engineStatus.mockResolvedValue(online);
    saveSettings.mockRejectedValue(new Error("dtes must be a non-empty subset of [7, 14]"));
    render(<StatusBar />);

    const sw = await screen.findByRole("switch", { name: "Engine" });
    await act(async () => {
      fireEvent.click(sw);
    });

    expect(await screen.findByText("dtes must be a non-empty subset of [7, 14]")).toBeDefined();
  });

  // Scanning is driven from the Scan board. The folio line only says whether a scan can run, so
  // these cases read the hint rather than a button that is no longer here.
  it("shows the next scan time and no scan control of its own", async () => {
    engineStatus.mockResolvedValue({ ...online, next_scan_at: "2026-09-16T22:30:00+00:00" });
    render(<StatusBar />);

    expect(await screen.findByText(/^Next scan /)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Scan now|Scanning/ })).toBeNull();
  });

  it("says why the desk is not scanning while a cycle is running", async () => {
    engineStatus.mockResolvedValue({ ...online, state: "scanning", next_scan_at: null });
    render(<StatusBar />);

    expect(await screen.findByText("Scanning now")).toBeDefined();
  });

  it("says a scan is held outside market hours when settings limit scans to US hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SATURDAY);
    engineStatus.mockResolvedValue({ ...online, market_hours_only: true });
    render(<StatusBar />);
    await act(async () => {});
    vi.useRealTimers();

    expect(screen.getByText(/Only scan during US market hours/)).toBeDefined();
  });

  it("warns that tickers will have no option data outside market hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SATURDAY);
    engineStatus.mockResolvedValue(online);
    render(<StatusBar />);
    await act(async () => {});
    vi.useRealTimers();

    expect(screen.getByText("US market is closed, so many tickers will have no option data.")).toBeDefined();
  });
});

describe("the account badge", () => {
  it("names the live account as a warning, always on screen", async () => {
    // Whether the next fill spends money is not something to go looking for.
    engineStatus.mockResolvedValue({ ...online, account_mode: "live" });
    render(<StatusBar />);
    expect(await screen.findByText("Live account")).toBeTruthy();
  });

  it("names the paper account", async () => {
    engineStatus.mockResolvedValue({ ...online, account_mode: "paper" });
    render(<StatusBar />);
    expect(await screen.findByText("Paper account")).toBeTruthy();
  });

  it("does not claim paper before the first status lands", async () => {
    engineStatus.mockResolvedValue({ ...online, account_mode: undefined });
    render(<StatusBar />);
    expect(await screen.findByText("Account —")).toBeTruthy();
    expect(screen.queryByText("Paper account")).toBeNull();
  });
});

