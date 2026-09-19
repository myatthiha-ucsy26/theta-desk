import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = { mode: "manual", tp_pct: 50, sl_multiple: 2, min_credit: 0.3, bot_paused: false, bot_pause_reason: "" };
const saveSettings = vi.fn((u: Record<string, unknown>) => Promise.resolve({ ...settings, ...u }));
let preflightReady = true;

vi.mock("../lib/api", () => ({
  api: {
    settings: () => Promise.resolve(settings),
    saveSettings: (u: Record<string, unknown>) => saveSettings(u),
    bot: () => Promise.resolve({ mode: "manual", paused: false, pause_reason: "", monitor: { state: "idle", last_ok: null, last_error: null },
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

afterEach(() => {
  cleanup();
  saveSettings.mockClear();
  announceSettingsSaved.mockClear();
  preflightReady = true;
});

describe("AutomationPanel", () => {
  it("switches on live trading only after typing LIVE", async () => {
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
    render(<AutomationPanel />);
    const button = await screen.findByRole("button", { name: "Start live trading" });
    fireEvent.change(screen.getByLabelText("Type LIVE to confirm"), { target: { value: "LIVE" } });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(announceSettingsSaved).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Live trading on")).toBeTruthy();
  });

  it("does not announce a switch-on that was rejected", async () => {
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
    preflightReady = false;
    render(<AutomationPanel />);
    expect(await screen.findByText(/wrong password/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type LIVE to confirm"), { target: { value: "LIVE" } });
    expect((screen.getByRole("button", { name: "Start live trading" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the fixed rules and compounding progress", async () => {
    render(<AutomationPanel />);
    expect(await screen.findByText("5-wide spreads · 1 contract · AI must CONFIRM")).toBeTruthy();
    expect(await screen.findByText("Net bot profit +$120 · 1 slot · next slot at $500")).toBeTruthy();
  });
});
