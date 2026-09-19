import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, BotStatus, Learn as LearnData, PaperBook, Settings as SettingsData } from "../lib/api";

const settings = vi.fn();
const saveSettings = vi.fn();
const resetSettings = vi.fn();
const learn = vi.fn();
const aiProviders = vi.fn();
const paper = vi.fn();
const bot = vi.fn();
const botPreflight = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: () => settings(),
      saveSettings: (updates: Partial<SettingsData>) => saveSettings(updates),
      resetSettings: () => resetSettings(),
      learn: (days: number) => learn(days),
      aiProviders: () => aiProviders(),
      paper: () => paper(),
      bot: () => bot(),
      botPreflight: () => botPreflight(),
    },
  };
});

// Spied rather than mocked: Settings uses the real module, we just watch it announce.
const announceSettingsSaved = vi.fn();
vi.mock("../lib/settingsBus", async () => {
  const actual = await vi.importActual<typeof import("../lib/settingsBus")>("../lib/settingsBus");
  return { ...actual, announceSettingsSaved: () => announceSettingsSaved() };
});

import { ApiError, SECRET_MASK } from "../lib/api";
import { setTemplate } from "../lib/templates";
import { Settings } from "./Settings";

const saved: SettingsData = {
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

const edge: LearnData = {
  days: 7, decisions: 0, errors: 0, funnel: [],
  edge: [
    {
      mode: "ivrich", dte: 7, bucket: "high", n: 24, expectancy: 42.5,
      win_rate: 0.7, validated: true, passes: true,
    },
  ],
  edge_built_at: "2026-09-16T21:32:11Z", min_n: 10, paper: [],
};

const OTHER = "https://vendor.test/anthropic";
const ANTHROPIC = "https://api.anthropic.com";

const PROVIDERS: AiProvider[] = [
  {
    id: "other", label: "Another Provider", url: OTHER, auth: "key",
    models: [
      { id: "other-fast", label: "Other Fast — quick" },
      { id: "other-pro", label: "Other Pro — slower, stronger reasoning" },
    ],
  },
  {
    id: "anthropic", label: "Anthropic", url: ANTHROPIC, auth: "key",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5 — strongest" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
    ],
  },
];

beforeEach(() => {
  settings.mockReset();
  saveSettings.mockReset();
  resetSettings.mockReset();
  learn.mockReset();
  aiProviders.mockReset();
  paper.mockReset();
  bot.mockReset();
  botPreflight.mockReset();
  announceSettingsSaved.mockReset();
  settings.mockResolvedValue(saved);
  learn.mockResolvedValue(edge);
  aiProviders.mockResolvedValue(PROVIDERS);
  // The desk's live state is context for the Minimal page, not something it needs to load. Left
  // unreachable by default, so only the tests that are about it have to say what it holds.
  paper.mockRejectedValue(new Error("offline"));
  bot.mockRejectedValue(new Error("offline"));
  botPreflight.mockRejectedValue(new Error("offline"));
});

afterEach(cleanup);

describe("Settings", () => {
  it("switches gates on and off, keeping signal and spread always on", async () => {
    saveSettings.mockResolvedValue({ ...saved, edge_enabled: false, dedupe_enabled: false });
    render(<Settings />);

    const signal = (await screen.findByRole("checkbox", { name: /^Signal/ })) as HTMLInputElement;
    const spread = screen.getByRole("checkbox", { name: /^Spread fits/ }) as HTMLInputElement;
    expect(signal.disabled && signal.checked && spread.disabled && spread.checked).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Backtest edge" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Not a repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({ edge_enabled: false, dedupe_enabled: false }),
    );
  });

  it("tells the rest of the app to re-read the engine status once a save lands", async () => {
    saveSettings.mockResolvedValue({ ...saved, engine_enabled: true });
    render(<Settings />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Engine on" }));
    expect(announceSettingsSaved).not.toHaveBeenCalled(); // a draft alone changes nothing

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(announceSettingsSaved).toHaveBeenCalledTimes(1));
  });

  it("does not announce a save that failed", async () => {
    saveSettings.mockRejectedValue(new Error("boom"));
    render(<Settings />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Engine on" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("boom")).toBeDefined();
    expect(announceSettingsSaved).not.toHaveBeenCalled();
  });

  it("enables Save on a change and sends only that change", async () => {
    saveSettings.mockResolvedValue({ ...saved, interval_min: 30 });
    render(<Settings />);

    const scanEvery = await screen.findByLabelText("Scan every");
    const save = screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(scanEvery, { target: { value: "30" } });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ interval_min: 30 }));
  });

  it("shows the server's message when a save is rejected", async () => {
    saveSettings.mockRejectedValue(
      new ApiError("dtes must be a non-empty list of days between 1 and 365", 400),
    );
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("Scan every"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      await screen.findByText("dtes must be a non-empty list of days between 1 and 365"),
    ).toBeDefined();
  });

  it("saves a custom expiration alongside the presets", async () => {
    saveSettings.mockResolvedValue({ ...saved, dtes: [7, 14, 30] });
    render(<Settings />);

    const input = await screen.findByLabelText("Custom");
    const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "30" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    expect((input as HTMLInputElement).value).toBe("");
    expect(add.disabled).toBe(true);
    expect(screen.getByLabelText("30")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ dtes: [7, 14, 30] }));
  });

  it("won't add a duplicate or out-of-range expiration", async () => {
    render(<Settings />);

    const input = await screen.findByLabelText("Custom");
    const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "7" } });
    expect(add.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "0" } });
    expect(add.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "366" } });
    expect(add.disabled).toBe(true);
  });

  it("re-gates the edge preview as the minimum trades changes", async () => {
    render(<Settings />);

    expect(await screen.findByText("Would pass")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Minimum trades"), { target: { value: "100" } });

    expect(screen.getByText("Would be blocked")).toBeDefined();
  });
});

describe("Settings · credentials", () => {
  it("sends a pasted key and token as the only change", async () => {
    saveSettings.mockResolvedValue({ ...saved, ai_api_key: SECRET_MASK, telegram_bot_token: "T" });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API key"), {
      target: { value: "sk-live-123" },
    });
    fireEvent.change(screen.getByLabelText("Telegram bot token"), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        ai_api_key: "sk-live-123",
        telegram_bot_token: "T",
      }),
    );
  });

  it("shows a saved key as the mask the server sent, never the key", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_key: SECRET_MASK });
    render(<Settings />);

    const key = (await screen.findByLabelText("API key")) as HTMLInputElement;
    expect(key.value).toBe(SECRET_MASK);
    expect(key.type).toBe("password");
    expect(await screen.findByText(/Saved\. Type over it to replace it/)).toBeDefined();
  });

  it("does not send a saved key back when something else changes", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_key: SECRET_MASK });
    saveSettings.mockResolvedValue({ ...saved, ai_api_key: SECRET_MASK, interval_min: 30 });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("Scan every"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    // The mask is what the server sent. Echoing it back is how an unrelated save would wipe a key.
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ interval_min: 30 }));
  });

  it("sends a cleared field as empty, which is what removes a stored key", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_key: SECRET_MASK });
    saveSettings.mockResolvedValue({ ...saved });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ ai_api_key: "" }));
  });

  it("says a key is unsaved until Save, so the hint never contradicts the field", async () => {
    render(<Settings />);

    expect(await screen.findByText(/With no key the AI answers UNAVAILABLE/)).toBeDefined();

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-live-123" } });

    expect(screen.getByText(/Not saved yet/)).toBeDefined();
    expect(screen.queryByText(/Saved\. Type over it/)).toBeNull();
  });

  it("stops saying Saved once the field is cleared", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_key: SECRET_MASK });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "" } });

    expect(screen.getByText(/With no key the AI answers UNAVAILABLE/)).toBeDefined();
    expect(screen.queryByText(/Saved\. Type over it/)).toBeNull();
  });

  it("leaves the chat ID readable, since it authenticates nothing", async () => {
    settings.mockResolvedValue({ ...saved, telegram_chat_id: "12345" });
    render(<Settings />);

    const chat = (await screen.findByLabelText("Telegram chat ID")) as HTMLInputElement;
    expect(chat.value).toBe("12345");
    expect(chat.type).toBe("text");
  });
});

describe("Settings · AI provider picker", () => {
  it("asks for the endpoint and the model before the key", async () => {
    render(<Settings />);

    const endpoint = await screen.findByLabelText("API endpoint");
    const model = screen.getByLabelText("Model");
    const key = screen.getByLabelText("API key");

    // A key on its own says nothing about who is being called; the two that do must come first.
    const before = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(endpoint, model)).toBe(true);
    expect(before(model, key)).toBe(true);
  });

  it("offers no models until an endpoint is chosen", async () => {
    render(<Settings />);

    const model = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    expect(model.disabled).toBe(true);
    expect([...model.options].map((o) => o.value)).toEqual([""]);
  });

  it("fills the endpoint and that provider's first model when one is picked", async () => {
    saveSettings.mockResolvedValue({ ...saved, ai_api_endpoint: ANTHROPIC, ai_model: "claude-opus-5" });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API endpoint"), { target: { value: ANTHROPIC } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        ai_api_endpoint: ANTHROPIC,
        ai_model: "claude-opus-5",
      }),
    );
  });

  it("lists the picked provider's models and drops the one before", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_endpoint: OTHER, ai_model: "other-pro" });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API endpoint"), { target: { value: ANTHROPIC } });

    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    // other-pro is not Anthropic's to serve; leaving it selected would look like a broken
    // AI review rather than a stale setting.
    expect([...model.options].map((o) => o.value)).toEqual(["", "claude-opus-5", "claude-sonnet-5"]);
    expect(model.value).toBe("claude-opus-5");
  });

  it("keeps the model when the new provider serves it too", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_endpoint: ANTHROPIC, ai_model: "claude-sonnet-5" });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API endpoint"), { target: { value: ANTHROPIC } });

    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("claude-sonnet-5");
  });

  it("opens on the provider a saved endpoint names", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_endpoint: ANTHROPIC, ai_model: "claude-sonnet-5" });
    render(<Settings />);

    expect(((await screen.findByLabelText("API endpoint")) as HTMLSelectElement).value).toBe(ANTHROPIC);
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("claude-sonnet-5");
    expect(screen.queryByLabelText("Custom endpoint URL")).toBeNull();
  });

  it("opens an endpoint it does not know as Custom, keeping the URL", async () => {
    const url = "https://ai.internal.corp/anthropic";
    settings.mockResolvedValue({ ...saved, ai_api_endpoint: url, ai_model: "house-model" });
    render(<Settings />);

    // The sentinel from Settings.tsx: Custom is a mode, so the select has no value to hold it.
    expect(((await screen.findByLabelText("API endpoint")) as HTMLSelectElement).value).toBe("__custom__");
    expect((screen.getByLabelText("Custom endpoint URL") as HTMLInputElement).value).toBe(url);
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("house-model");
  });

  it("reveals a URL field, and a text model, when Custom is chosen", async () => {
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API endpoint"), { target: { value: "__custom__" } });

    expect(screen.getByLabelText("Custom endpoint URL")).toBeDefined();
    expect((screen.getByLabelText("Model") as HTMLInputElement).type).toBe("text");
  });

  it("clears a provider's URL when Custom is chosen, so the screen cannot lie", async () => {
    settings.mockResolvedValue({ ...saved, ai_api_endpoint: ANTHROPIC, ai_model: "claude-opus-5" });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("API endpoint"), { target: { value: "__custom__" } });

    expect((screen.getByLabelText("Custom endpoint URL") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("");
  });
});

const paperBook: PaperBook = {
  open: [], closed: [],
  stats: { total_pnl: 0, wins: 0, losses: 0, win_rate: 0, open_count: 0, deployed_risk: 0, risk_cap: 2500 },
};

const botIdle: BotStatus = {
  mode: "manual", account_mode: "paper", paused: false, pause_reason: "",
  monitor: { state: "idle", last_ok: null, last_error: null },
  net_pnl: 0, slots: 1, next_slot_at: 500,
  active: [], closed: [], marks: {}, events: [],
};

describe("Settings in the Minimal template", () => {
  afterEach(() => setTemplate("broadsheet"));

  it("sets the page under section heads, with a head that reports the saved desk", async () => {
    setTemplate("minimal");
    render(<Settings />);

    // Saved, not drafted: the engine and live trading are both off in the stored copy.
    expect(await screen.findByRole("heading", { name: "Settings & Risk Governance" })).toBeDefined();
    expect(screen.getByText("Engine off")).toBeDefined();
    expect(screen.getByText("Live trading off")).toBeDefined();

    // Every panel is still here, now under a section of its own.
    for (const label of [
      "Live automation", "Engine & schedule", "What it scans",
      "Risk boundaries", "Review & alerts", "Appearance",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeDefined();
    }
    expect(screen.getByRole("heading", { name: "Gates" })).toBeDefined();
  });

  it("leaves the Broadsheet column exactly as it was", async () => {
    render(<Settings />);

    await screen.findByRole("heading", { name: "Gates" });
    expect(screen.queryByRole("heading", { name: "Settings & Risk Governance" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Risk boundaries" })).toBeNull();
  });

  it("shows the risk cap against what the book has actually deployed", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue({
      ...paperBook,
      stats: { ...paperBook.stats, deployed_risk: 1200 },
    });
    render(<Settings />);

    // $1,200 held against the saved $2,500 cap, so $1,300 of it is still free.
    expect(await screen.findByText("Allocated")).toBeDefined();
    expect(screen.getByText("$1,200")).toBeDefined();
    expect(screen.getByText("$1,300")).toBeDefined();
    expect(screen.getByRole("img", { name: "48% of the cap deployed" })).toBeDefined();
  });

  it("sets the cap from the slider, and the exact field still types it", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(paperBook);
    saveSettings.mockResolvedValue({ ...saved, max_deployed_risk: 4000 });
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("Hard cap"), { target: { value: "4000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ max_deployed_risk: 4000 }));
    expect((screen.getByLabelText("Maximum deployed risk") as HTMLInputElement).value).toBe("4000");
  });

  it("counts the pending edits on the head as well as at the action bar", async () => {
    setTemplate("minimal");
    paper.mockResolvedValue(paperBook);
    render(<Settings />);

    fireEvent.change(await screen.findByLabelText("Hard cap"), { target: { value: "4000" } });

    expect(screen.getAllByText("1 unsaved change")).toHaveLength(2);
  });

  it("shows the slots the bot has earned, with the engine's own step", async () => {
    setTemplate("minimal");
    bot.mockResolvedValue({ ...botIdle, net_pnl: 620, slots: 2, next_slot_at: 1000 });
    render(<Settings />);

    expect(await screen.findByText("Slots earned")).toBeDefined();
    expect(screen.getByText("2 of 5")).toBeDefined();
    expect(screen.getByText("+$620")).toBeDefined();
    // Both read off the engine's figures rather than restated here: the step is next_slot_at/slots,
    // and the gap is how far the net profit still is from the next threshold.
    expect(screen.getByText(/One base slot.*\$500 of net profit.*\$380 to go/)).toBeDefined();
  });

  it("moves the slot figures onto the card in Minimal, leaving the one-line summary to Broadsheet", async () => {
    // Both editions fetch the same bot; only Broadsheet has no card to draw the figures on.
    bot.mockResolvedValue({ ...botIdle, net_pnl: 620, slots: 2, next_slot_at: 1000 });
    botPreflight.mockResolvedValue({ checks: [], ready: false });

    render(<Settings />);
    expect(await screen.findByText(/^Net bot profit .* next slot at/)).toBeDefined();
    cleanup();

    setTemplate("minimal");
    render(<Settings />);
    await screen.findByText("Slots earned");
    // Anchored, because the card carries a "Net bot profit" caption of its own.
    expect(screen.queryByText(/^Net bot profit .* next slot at/)).toBeNull();
  });

  it("leaves the slot card off when the desk cannot be reached, rather than failing the page", async () => {
    setTemplate("minimal");
    render(<Settings />);

    await screen.findByRole("heading", { name: "Risk boundaries" });
    expect(screen.queryByText("Slots earned")).toBeNull();
    // The cap card is still there — it just has nothing to show against the cap.
    expect(screen.getByText("Allocated")).toBeDefined();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});