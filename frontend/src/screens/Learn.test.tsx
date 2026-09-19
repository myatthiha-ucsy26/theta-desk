import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Learn as LearnData, Settings as SettingsData } from "../lib/api";

const learn = vi.fn();
const settings = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      learn: (days: number) => learn(days),
      settings: () => settings(),
    },
  };
});

import { Learn } from "./Learn";
import { setTemplate } from "../lib/templates";

const desk: SettingsData = {
  engine_enabled: false, mode: "manual", account_mode: "paper", paper_starting_cash: 10000, paper_fee_per_contract: 0.65, watchlist: ["SPY", "QQQ", "META"],
  modes: ["ivrich"], dtes: [7, 14], interval_min: 15, ticker_gap_sec: 5,
  market_hours_only: true, edge_min_n: 10, edge_min_expectancy: 0,
  max_open_positions: 5, max_deployed_risk: 2500, ai_enabled: true,
  edge_enabled: true, risk_enabled: true, dedupe_enabled: true,
  ai_allow_caution: true, alert_cooldown_hours: 24,
  ai_api_key: "", ai_api_endpoint: "", ai_model: "",
  telegram_bot_token: "", telegram_chat_id: "",
  tp_pct: 50, sl_multiple: 2, min_credit: 0.3, bot_paused: false, bot_pause_reason: "",
};

const data: LearnData = {
  days: 7, decisions: 120, errors: 3,
  funnel: [
    { stage: "signal", reached: 120, stopped: 40 },
    { stage: "tradeable", reached: 80, stopped: 30 },
    { stage: "edge", reached: 50, stopped: 20 },
    { stage: "risk", reached: 30, stopped: 10 },
    { stage: "ai", reached: 20, stopped: 15 },
    { stage: "dedupe", reached: 5, stopped: 0 },
    { stage: "alert", reached: 5, stopped: 0 },
  ],
  edge: [
    {
      mode: "ivrich", dte: 7, bucket: "high", n: 24, expectancy: 42.5,
      win_rate: 0.7, validated: true, passes: true,
    },
    {
      mode: "ivrich", dte: 14, bucket: "low", n: 3, expectancy: -8,
      win_rate: null, validated: false, passes: false,
    },
  ],
  edge_built_at: "2026-09-16T21:32:11Z",
  min_n: 10,
  paper: [
    {
      mode: "ivrich", paper_n: 4, paper_win_rate: 0.5, paper_expectancy: 12.3,
      paper_total: 49, backtest_n: 24, backtest_expectancy: 42.5,
    },
    {
      mode: "trend", paper_n: 1, paper_win_rate: 0, paper_expectancy: -5,
      paper_total: -5, backtest_n: 0, backtest_expectancy: null,
    },
  ],
};

beforeEach(() => {
  learn.mockReset();
  learn.mockResolvedValue(data);
  settings.mockReset();
  settings.mockResolvedValue(desk);
});

afterEach(() => {
  cleanup();
  setTemplate("broadsheet");
});

describe("Learn", () => {
  it("marks a setup that passes and one that is still too thin", async () => {
    render(<Learn />);

    expect(await screen.findByText("Passes")).toBeDefined();
    expect(screen.getByText("Too few trades")).toBeDefined();
  });

  it("asks for the new period when the range changes", async () => {
    render(<Learn />);

    await screen.findByText("Passes");
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));

    await waitFor(() => expect(learn).toHaveBeenCalledWith(30));
  });
});

describe("Learn in the Minimal template", () => {
  it("states both numbers at each step of the funnel, not just how many arrived", async () => {
    setTemplate("minimal");
    render(<Learn />);

    await screen.findByText("Passes");
    expect(screen.getByText("120 reached")).toBeDefined();
    expect(screen.getByText("40 stopped here")).toBeDefined();
  });

  it("plots the paper record against the backtest it tracks, on one scale", async () => {
    setTemplate("minimal");
    render(<Learn />);

    await screen.findByText("Passes");
    // Each mode carries both series by name, and the figure beside each is the number the table
    // would have shown — the plot adds the comparison rather than replacing the readings.
    expect(screen.getAllByText("Backtest")).toHaveLength(2);
    expect(screen.getAllByText("Paper")).toHaveLength(2);
    expect(screen.getByText("4 paper trades against 24 backtest")).toBeDefined();

    // The trend row has no gated backtest behind it, so no drift is stated for it: one comparison
    // is real, the other is not there yet.
    expect(screen.getByText("1 paper trade against 0 backtest")).toBeDefined();
    expect(screen.getAllByText(/a trade behind the backtest/)).toHaveLength(1);
  });

  it("explains each gate from the desk's own settings, not the defaults", async () => {
    setTemplate("minimal");
    settings.mockResolvedValue({
      ...desk,
      max_open_positions: 3,
      max_deployed_risk: 1200,
      alert_cooldown_hours: 12,
    });
    render(<Learn />);

    // The conditions are the engine's, and the three that are configurable are read back from
    // Settings so the panel cannot describe a desk that is no longer configured that way.
    expect(await screen.findByText(/A free slot under 3,/)).toBeDefined();
    expect(screen.getByText(/inside \$1200\./)).toBeDefined();
    expect(screen.getByText(/last 12h\./)).toBeDefined();
    expect(screen.getByText(/trades at positive expectancy/)).toBeDefined();
  });
});