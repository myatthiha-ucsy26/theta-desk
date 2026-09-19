import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  mode: "manual", account_mode: "paper", tp_pct: 50, sl_multiple: 2, min_credit: 0.3,
  bot_paused: false, bot_pause_reason: "",
};
let settings: Record<string, unknown> = { ...base };
const saveSettings = vi.fn((u: Record<string, unknown>) => Promise.resolve({ ...settings, ...u }));
let preflightReady = true;

vi.mock("../lib/api", () => ({
  api: {
    settings: () => Promise.resolve(settings),
    saveSettings: (u: Record<string, unknown>) => saveSettings(u),
    bot: () => Promise.resolve({ mode: "manual", account_mode: "paper", paused: false, pause_reason: "",
      monitor: { state: "idle", last_ok: null, last_error: null },
      net_pnl: 120, slots: 1, next_slot_at: 500, active: [], closed: [], marks: {}, events: [] }),
    botPreflight: () => Promise.resolve({
      ready: preflightReady,
      checks: [{ name: "Trading unlocked", ok: preflightReady, detail: preflightReady ? "" : "unlock: wrong password" }],
    }),
  },
}));

import { AutomationPanel } from "./AutomationPanel";

// Spied, not mocked: the panel uses the real module, we just watch it announce.
const announceSettingsSaved = vi.fn();
vi.mock("../lib/settingsBus", async () => {
  const actual = await vi.importActual<typeof import("../lib/settingsBus")>("../lib/settingsBus");
  return { ...actual, announceSettingsSaved: () => announceSettingsSaved() };
});

const onLiveAccount = () => { settings = { ...base, account_mode: "live" }; };

afterEach(() => {
  cleanup();
  saveSettings.mockClear();
  announceSettingsSaved.mockClear();
  preflightReady = true;
  settings = { ...base };
});

describe("AutomationPanel on the paper account", () => {
  it("starts the bot with no confirmation and no pre-flight", async () => {
    // Nothing is at stake, so demanding a ritual here would only teach the habit
    // of typing LIVE without reading.
    preflightReady = false;
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Start the paper bot" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(saveSettings).toHaveBeenCalledWith({ mode: "auto" });
  });

  it("says plainly that nothing reaches the real account", async () => {
    render(<AutomationPanel />);
    expect(await screen.findByText(/simulated from live quotes/i)).toBeTruthy();
    expect(screen.getByText("Paper account")).toBeTruthy();
  });

  it("offers the switch to the live account", async () => {
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Switch to the live account" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(saveSettings).toHaveBeenCalledWith({ account_mode: "live" });
  });
});

describe("AutomationPanel on the live account", () => {
  it("switches on live trading only after typing LIVE", async () => {
    onLiveAccount();
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Start live trading" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type LIVE to confirm"), { target: { value: "LIVE" } });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(saveSettings).toHaveBeenCalledWith({ mode: "auto", confirm: "LIVE" });
  });

  it("tells the rest of the app once live trading turns on", async () => {
    onLiveAccount();
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Start live trading" });
    fireEvent.change(screen.getByLabelText("Type LIVE to confirm"), { target: { value: "LIVE" } });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(announceSettingsSaved).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Trading live")).toBeTruthy();
  });

  it("does not announce a switch-on that was rejected", async () => {
    onLiveAccount();
    saveSettings.mockRejectedValueOnce(new Error("Trading is locked"));
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Start live trading" });
    fireEvent.change(screen.getByLabelText("Type LIVE to confirm"), { target: { value: "LIVE" } });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(await screen.findByText("Trading is locked")).toBeTruthy();
    expect(announceSettingsSaved).not.toHaveBeenCalled();
  });

  it("keeps the switch disabled while pre-flight fails and says why", async () => {
    onLiveAccount();
    preflightReady = false;
    render(<AutomationPanel />);
    expect(await screen.findByText(/wrong password/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type LIVE to confirm"), { target: { value: "LIVE" } });
    expect((screen.getByRole("button", { name: "Start live trading" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces a refused switch back to paper instead of pretending it worked", async () => {
    onLiveAccount();
    saveSettings.mockRejectedValueOnce(
      new Error("Close the live account's open positions first (SPY)."));
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Switch to the paper account" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByText(/open positions first \(SPY\)/)).toBeTruthy();
  });
});

describe("AutomationPanel", () => {
  it("shows the fixed rules and compounding progress", async () => {
    render(<AutomationPanel />);
    expect(await screen.findByText("5-wide spreads · 1 contract · AI must CONFIRM")).toBeTruthy();
    expect(await screen.findByText("Net bot profit +$120 · 1 slot · next slot at $500")).toBeTruthy();
  });
});
