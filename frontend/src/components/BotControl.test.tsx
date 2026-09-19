import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotStatus } from "../lib/api";

const status: BotStatus = {
  mode: "auto", paused: false, pause_reason: "",
  monitor: { state: "watching", last_ok: null, last_error: null },
  net_pnl: 0, slots: 1, next_slot_at: 500, active: [], closed: [], marks: {}, events: [],
};
const stopBot = vi.fn(() => Promise.resolve({ ...status, paused: true, pause_reason: "stopped by you" }));
const resumeBot = vi.fn(() => Promise.resolve(status));
let current = status;

vi.mock("../lib/api", () => ({
  api: { bot: () => Promise.resolve(current), stopBot: () => stopBot(), resumeBot: () => resumeBot() },
}));

import { BotControl } from "./BotControl";
import { announceSettingsSaved } from "../lib/settingsBus";

afterEach(() => {
  cleanup();
  current = status;
});

describe("BotControl", () => {
  it("stops trading in one click", async () => {
    render(<BotControl />);
    await screen.findByText("Bot watching");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop trading" }));
    });
    expect(stopBot).toHaveBeenCalledOnce();
    expect(await screen.findByText("Bot paused: stopped by you")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("shows nothing to press when the bot is off", async () => {
    current = { ...status, mode: "manual" };
    render(<BotControl />);
    await screen.findByText("Bot off");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("re-reads the bot state when live trading is switched on elsewhere", async () => {
    current = { ...status, mode: "manual" };
    render(<BotControl />);
    await screen.findByText("Bot off");

    // AutomationPanel has just saved mode=auto; the header must not wait out its 15s poll.
    current = status;
    await act(async () => {
      announceSettingsSaved();
    });

    expect(await screen.findByText("Bot watching")).toBeTruthy();
    expect(screen.queryByText("Bot off")).toBeNull();
  });
});
