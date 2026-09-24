import { useEffect, useState, type ReactNode } from "react";
import { AutomationPanel } from "../components/AutomationPanel";
import { BotIcon, GATE_ICONS, SCREEN_ICONS } from "../components/Icons";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { api, SECRET_MASK, type AiProvider, type BotStatus, type EdgeCell, type Settings as SettingsData, type SignalMode } from "../lib/api";
import { announceSettingsSaved } from "../lib/settingsBus";
import { TEMPLATES, setTemplate, useTemplate, type TemplateId } from "../lib/templates";
import { useTheme } from "../lib/theme";
import { marketHours } from "../lib/time";
import { toast } from "../lib/toast";
import { GATES, changedSettings, formatMoney, wouldPass } from "../lib/views";
import { BTN, BTN_DANGER, INPUT, LABEL } from "../lib/ui";

const CONFIRM_MS = 5000;

const NUMBER = `w-28 ${INPUT}`;
const WIDE = `w-full ${INPUT}`;
const ACTION_BUTTON = BTN;
const PRIMARY_BUTTON =
  "inline-flex items-center gap-1.5 border border-profit bg-profit px-3 py-1.5 text-sm text-sheet transition-colors hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50";
const CONFIRM_BUTTON = BTN_DANGER;

const MODES: { key: SignalMode; label: string }[] = [
  { key: "ivrich", label: "IV rich" },
  { key: "meanrev", label: "Mean reversion" },
  { key: "trend", label: "Trend" },
];

const DIRECTIONS: { key: SettingsData["directions"][number]; label: string }[] = [
  { key: "SELL_PUT", label: "Bull put" },
  { key: "SELL_CALL", label: "Bear call" },
];

// The setting that switches each gate. Signal and spread fits have none: without them there is no trade.
const GATE_SWITCH: Partial<Record<(typeof GATES)[number]["stage"], keyof SettingsData>> = {
  edge: "edge_enabled",
  risk: "risk_enabled",
  ai: "ai_enabled",
  dedupe: "dedupe_enabled",
};

const PRESET_DTES = [7, 14];
const DTE_MIN = 1;
const DTE_MAX = 365;

// The endpoint dropdown's third kind of choice. "Not set" and each provider are values;
// Custom is a mode -- the endpoint is whatever gets typed -- so it needs a sentinel to select it.
const CUSTOM = "__custom__";

const BUCKET_LABEL: Record<EdgeCell["bucket"], string> = {
  low: "Low IV rank",
  mid: "Mid IV rank",
  high: "High IV rank",
  unranked: "Unranked IV rank",
};

// A miniature of each template, drawn from the same tokens as the app — so the thumb tells the
// truth in either edition, and can never go stale the way a screenshot would. The frame it is
// drawn in carries the template's own id and the current edition, which is what scopes the
// tokens: each thumb shows its own colours even while another template is the active one.
const PREVIEW: Record<TemplateId, ReactNode> = {
  broadsheet: (
    <>
      <span className="block h-[3px] w-1/2 bg-ink" />
      <span className="mt-1 block h-px w-full bg-rule-strong" />
      <span className="mt-1.5 block h-1.5 w-2/3 bg-ink" />
      <span className="mt-1 block h-px w-1/2 bg-rule" />
      <span className="mt-1.5 block h-1.5 w-1/2 bg-profit" />
    </>
  ),
  minimal: (
    <>
      <span className="block h-1 w-1/3 bg-ink-2" />
      <span className="mt-2 block h-1.5 w-3/4 bg-ink" />
      <span className="mt-2 block h-px w-full bg-rule" />
      <span className="mt-1.5 block h-px w-full bg-rule" />
      <span className="mt-2 block h-1.5 w-1/3 bg-profit" />
    </>
  ),
  holo: (
    <span className="flex flex-1 items-center gap-1.5">
      <span className="holo-thumb-orb block h-5 w-5 shrink-0 rounded-full" />
      <span className="flex flex-1 flex-col gap-1">
        <span className="block h-1.5 w-full rounded-sm border border-rule bg-sheet" />
        <span className="block h-1.5 w-2/3 rounded-sm bg-profit" />
      </span>
    </span>
  ),
};

/**
 * A labelled credential field, with the line that says what leaving it blank does.
 *
 * A secret is typed masked and comes back from the server masked, so the field never holds the
 * real value: typing over it replaces the stored one, and clearing it removes one.
 */
function Field({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  secret,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type={secret ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 ${WIDE}`}
      />
      <p className="mt-1.5 text-sm text-ink-2">{hint}</p>
    </div>
  );
}

/** A labelled dropdown, wearing the same clothes as the text fields so it does not stand out. */
function Select({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 ${WIDE}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-sm text-ink-2">{hint}</p>
    </div>
  );
}

/** A caption over a figure: the unit every card on this page is built from. */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="eyebrow text-ink-2">{label}</p>
      <p className="figure mt-1 text-xl text-ink">{value}</p>
    </div>
  );
}

/**
 * A section: a glyph, its name, and the hairline that runs out to the edge — so the page reads as
 * a contents list rather than as a column of panels all weighing the same.
 *
 * The Broadsheet column has no use for one, so there it hands its children straight through, which
 * is what keeps that edition's page exactly as it was.
 */
function Section({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  if (useTemplate() !== "minimal") return <>{children}</>;
  return (
    <section className="sx-section">
      <h2 className="sx-section-head">
        <span className="sx-section-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="eyebrow text-ink">{label}</span>
        <span className="sx-section-rule" aria-hidden="true" />
      </h2>
      {children}
    </section>
  );
}

/**
 * The page head. It reports the desk's saved state rather than the draft — what is actually
 * running, not what is being typed. The pending edits are counted on the same line.
 */
function PageHead({ saved, count }: { saved: SettingsData; count: number }) {
  if (useTemplate() !== "minimal") return null;
  const hours = marketHours();
  return (
    <header className="border-b border-rule pb-4">
      <h1 className="sx-title">Settings &amp; Risk Governance</h1>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={saved.engine_enabled ? "good" : "neutral"}
          label={saved.engine_enabled ? "Engine on" : "Engine off"}
        />
        <StatusBadge
          tone={saved.mode === "auto" ? "good" : "neutral"}
          label={saved.mode === "auto" ? "Live trading on" : "Live trading off"}
        />
        <span className="chip">US market {hours.open}–{hours.close}</span>
        {count > 0 && (
          <span className="chip">
            {count} unsaved {count === 1 ? "change" : "changes"}
          </span>
        )}
      </div>
    </header>
  );
}

// The slider's own granularity, and the range it spans before the top follows the cap upward. Both
// are properties of the control rather than claims about the desk, which is why the typed field
// stays the one that holds the exact number.
const RISK_STEP = 100;
const RISK_RANGE = 10000;

/**
 * The hard cap, drawn as the cap rather than as a number in a box: the slider sets it, the field
 * beside it types it exactly, and the bar underneath says how much of it the book has spent.
 *
 * The allocated side is real — it is what the paper book holds right now — and the bar only means
 * something as a pair, so both numbers are shown against the one cap.
 */
function RiskCap({
  cap,
  deployed,
  onChange,
}: {
  cap: number;
  deployed: number | null;
  onChange: (v: number) => void;
}) {
  const top = Math.max(RISK_RANGE, Math.ceil(cap / RISK_STEP) * RISK_STEP);
  const used = deployed ?? 0;
  const spent = cap > 0 ? Math.min(100, Math.max(0, (used / cap) * 100)) : 0;
  const headroom = cap - used;

  // The terminal draws this as a card of its own; Broadsheet already has it inside the Risk limits
  // panel, so there it is the panel's own rules and spacing rather than a nested box.
  const minimal = useTemplate() === "minimal";

  return (
    <div className={minimal ? "sx-card" : "mt-4 border-t border-rule pt-4"}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Stat label="Allocated" value={deployed === null ? "—" : formatMoney(used, { signed: false })} />
        <Stat label="Headroom" value={deployed === null ? "—" : formatMoney(headroom, { signed: false })} />
        <div className="min-w-[11rem] flex-1">
          <label htmlFor="max-risk-range" className={LABEL}>
            Hard cap
          </label>
          <input
            id="max-risk-range"
            type="range"
            min={0}
            max={top}
            step={RISK_STEP}
            value={Math.min(cap, top)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="sx-range mt-1.5"
          />
        </div>
      </div>

      <div className="sx-split mt-3" role="img" aria-label={`${Math.round(spent)}% of the cap deployed`}>
        <span className="sx-split-used" style={{ width: `${spent}%` }} />
        <span className="sx-split-free" />
      </div>

      <p className="mt-2 text-xs text-ink-2">
        {deployed === null
          ? "The paper book is not readable, so there is nothing to show against the cap."
          : headroom < 0
            ? `${formatMoney(used, { signed: false })} committed against a cap of ${formatMoney(cap, { signed: false })} — already past it, so the risk gate is turning every new setup away.`
            : `${formatMoney(used, { signed: false })} of ${formatMoney(cap, { signed: false })} committed. ${formatMoney(headroom, { signed: false })} left before the risk gate turns a new setup away.`}
      </p>
    </div>
  );
}

/**
 * The slots the bot has earned so far, and the ones it is still working toward.
 *
 * The step is read off the engine's own figures rather than restated here, so this card can never
 * drift from the rule the engine actually runs. The live state is a nicety on a settings page, so
 * a desk that cannot be reached simply leaves the card off rather than failing the page.
 */
function BotSlots({ cap }: { cap: number }) {
  const [bot, setBot] = useState<BotStatus | null>(null);

  useEffect(() => {
    let live = true;
    api
      .bot()
      .then((b) => live && setBot(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (useTemplate() !== "minimal" || !bot) return null;

  const step = bot.slots > 0 ? bot.next_slot_at / bot.slots : 0;
  const total = Math.max(cap, bot.slots);

  return (
    <div className="sx-card">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Stat label="Slots earned" value={`${bot.slots} of ${cap}`} />
        <Stat label="Net bot profit" value={formatMoney(bot.net_pnl, { signed: true })} />
        <Stat label="Next slot at" value={formatMoney(bot.next_slot_at, { signed: false })} />
      </div>

      {/* Tiles stay tile-sized and wrap, rather than stretching to fill the card. */}
      <ol className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <li key={i} className={`sx-slot w-11 ${i < bot.slots ? "sx-slot-on" : "sx-slot-off"}`}>
            {i + 1}
          </li>
        ))}
      </ol>

      <p className="mt-2 text-xs text-ink-2">
        One base slot, plus one more for every {formatMoney(step, { signed: false })} of net profit —{" "}
        {formatMoney(bot.next_slot_at - bot.net_pnl, { signed: false })} to go. Maximum open positions
        caps the count at {cap}.
      </p>
    </div>
  );
}

/** The engine's own settings, edited as a draft and sent only as a diff. */
export function Settings() {
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [customEndpoint, setCustomEndpoint] = useState(false);
  const [cells, setCells] = useState<EdgeCell[]>([]);
  const [watchlist, setWatchlist] = useState("");
  const [customDte, setCustomDte] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deployed, setDeployed] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.settings(), api.learn(7), api.aiProviders()])
      .then(([s, l, p]) => {
        if (!live) return;
        setProviders(p);
        // An endpoint that matches no provider was typed by hand, so the screen opens in the
        // state that shows it as text rather than silently snapping it to the nearest provider.
        setCustomEndpoint(s.ai_api_endpoint !== "" && !p.some((e) => e.url === s.ai_api_endpoint));
        setSaved(s);
        setDraft(s);
        setWatchlist(s.watchlist.join(", "));
        setCells(l.edge);
      })
      .catch((e: unknown) => {
        if (live) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  // A confirm left open goes stale: it offers defaults the person may no longer want.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  // What the risk cap is measured against. It is context for the cap card, not a setting, so a desk
  // that cannot answer for the paper book leaves that card's figures blank rather than failing the
  // page — the setting itself is editable either way.
  useEffect(() => {
    let live = true;
    api
      .paper()
      .then((p) => live && setDeployed(p.stats.deployed_risk))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const changes = saved && draft ? changedSettings(saved, draft) : {};
  const count = Object.keys(changes).length;
  const hours = marketHours();
  const template = useTemplate();
  const theme = useTheme();
  // The server sends a saved key back masked, so what the field holds is the mask, not the key.
  // Read off the draft rather than the saved copy: a cleared field must not still say "Saved".
  const keyHint =
    draft?.ai_api_key === SECRET_MASK
      ? "Saved. Type over it to replace it, or clear the field to remove it."
      : draft?.ai_api_key
        ? "Not saved yet — press Save to store it. It goes one way and is never read back."
        : "With no key the AI answers UNAVAILABLE, and the engine reads that as a no.";

  const provider = providers.find((p) => p.url === draft?.ai_api_endpoint);
  // What the endpoint dropdown shows. A blank endpoint is "Not set" rather than a provider:
  // nothing is built in, so until one is chosen here or named in the environment, the review
  // simply does not run.
  const endpointChoice = customEndpoint ? CUSTOM : (provider?.url ?? "");

  function update<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  /** The backtested default tickers, filled into the draft like any other edit — nothing else resets. */
  async function fillDefaultTickers() {
    try {
      const { watchlist: defaults } = await api.settingsDefaults();
      setWatchlist(defaults.join(", "));
      update("watchlist", defaults);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Choosing an endpoint also re-picks the model, because the list belongs to the endpoint: a
   * name the old provider served would be a 400 from the new one, and it would look like the
   * trade setup was broken rather than the setting.
   */
  function chooseEndpoint(url: string) {
    if (url === CUSTOM) {
      setCustomEndpoint(true);
      // A provider's own URL left in the field would keep calling that provider while the screen
      // said Custom, so it is cleared for the person to type over.
      update("ai_api_endpoint", provider ? "" : (draft?.ai_api_endpoint ?? ""));
      update("ai_model", "");
      return;
    }
    setCustomEndpoint(false);
    const next = providers.find((p) => p.url === url);
    update("ai_api_endpoint", next?.url ?? "");
    // "Not set" has no model list of its own, so clear the model with it.
    const keep = next?.models.some((m) => m.id === draft?.ai_model);
    update("ai_model", next ? (keep ? (draft?.ai_model ?? "") : (next.models[0]?.id ?? "")) : "");
  }

  function toggled<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  // Presets in a fixed order, then whatever custom expirations are configured.
  function shownDtes(dtes: number[]): number[] {
    return [...PRESET_DTES, ...dtes.filter((d) => !PRESET_DTES.includes(d)).sort((a, b) => a - b)];
  }

  function addDte() {
    const dte = Number(customDte);
    if (!draft || !canAddDte) return;
    update("dtes", [...draft.dtes, dte].sort((a, b) => a - b));
    setCustomDte("");
  }

  async function save() {
    if (!draft || count === 0 || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const next = await api.saveSettings(changes);
      setSaved(next);
      setDraft(next);
      setWatchlist(next.watchlist.join(", "));
      toast(`Settings saved (${count} ${count === 1 ? "change" : "changes"})`);
      // The header reads its own copy of this; it must not show the old value.
      announceSettingsSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (busy) return;
    setBusy(true);
    setSaveError(null);
    setConfirming(false);
    try {
      const next = await api.resetSettings();
      setSaved(next);
      setDraft(next);
      setWatchlist(next.watchlist.join(", "));
      toast("Settings restored to defaults");
      announceSettingsSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Panel title="Settings">
        <p className="text-sm text-critical">{loadError}</p>
      </Panel>
    );
  }

  // Both arrive from the same response, so waiting on both is waiting on the one load — and it is
  // what lets the page head read the saved copy rather than the draft.
  if (!draft || !saved) {
    return (
      <Panel title="Settings">
        <p className="text-sm text-ink-2">Loading settings…</p>
      </Panel>
    );
  }

  const preview = cells
    .filter((c) => draft.modes.includes(c.mode) && draft.dtes.includes(c.dte))
    .sort(
      (a, b) =>
        a.mode.localeCompare(b.mode) || a.dte - b.dte || a.bucket.localeCompare(b.bucket),
    );

  const pendingDte = Number(customDte);
  const canAddDte =
    customDte.trim() !== "" &&
    Number.isInteger(pendingDte) &&
    pendingDte >= DTE_MIN &&
    pendingDte <= DTE_MAX &&
    !draft.dtes.includes(pendingDte);

  return (
    <div className="flex flex-col gap-8">
      <PageHead saved={saved} count={count} />

      <Section icon={<BotIcon />} label="Live automation">
        <AutomationPanel />
        <BotSlots cap={draft.max_open_positions} />
      </Section>

      <Section icon={SCREEN_ICONS.scan} label="Engine & schedule">
        <Panel title="Engine">
          <div className="flex flex-col gap-6">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.engine_enabled}
                onChange={(e) => update("engine_enabled", e.target.checked)}
              />
              Engine on
            </label>

            <div>
              <p className={LABEL}>Mode</p>
              <p className="mt-0.5 text-sm text-ink-2">
                Manual (the engine alerts; it never places orders)
              </p>
            </div>

            <div>
              <label htmlFor="interval-min" className={LABEL}>
                Scan every
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="interval-min"
                  type="number"
                  min={1}
                  value={draft.interval_min}
                  onChange={(e) => update("interval_min", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">minutes</span>
              </div>
            </div>

            <div>
              <label htmlFor="ticker-gap-sec" className={LABEL}>
                Pause between tickers
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="ticker-gap-sec"
                  type="number"
                  min={0}
                  value={draft.ticker_gap_sec}
                  onChange={(e) => update("ticker_gap_sec", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">seconds</span>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.market_hours_only}
                  onChange={(e) => update("market_hours_only", e.target.checked)}
                />
                Only scan during US market hours
              </label>
              <p className="mt-1.5 text-xs text-ink-2">
                The regular session runs {hours.open} to {hours.close} your time.
              </p>
            </div>
          </div>
        </Panel>
      </Section>

      <Section icon={GATE_ICONS["Signal"]} label="What it scans">
        <Panel title="What to scan">
          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor="watchlist" className="block text-sm text-ink">
                Watchlist
              </label>
              <textarea
                id="watchlist"
                rows={2}
                value={watchlist}
                onChange={(e) => setWatchlist(e.target.value)}
                onBlur={() =>
                  update(
                    "watchlist",
                    watchlist
                      .split(/[\s,]+/)
                      .filter(Boolean)
                      .map((t) => t.toUpperCase()),
                  )
                }
                className={`mt-1.5 w-full max-w-lg font-display text-lg ${INPUT}`}
              />
              <p className="mt-1.5 flex max-w-lg flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-ink-2">
                Separate tickers with commas or spaces.
                <button type="button" onClick={fillDefaultTickers} className="text-accent underline-offset-2 hover:underline">
                  Use default tickers
                </button>
              </p>
            </div>

            <fieldset>
              <legend className={LABEL}>Signal modes</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {MODES.map((m) => (
                  <label key={m.key} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={draft.modes.includes(m.key)}
                      onChange={() => update("modes", toggled(draft.modes, m.key))}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-2">
                A signal fires when any checked mode fires. ivrich held up in the 2022 bear market; trend did not.
              </p>
            </fieldset>

            <fieldset>
              <legend className={LABEL}>Spread types</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {DIRECTIONS.map((d) => (
                  <label key={d.key} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={draft.directions.includes(d.key)}
                      onChange={() => update("directions", toggled(draft.directions, d.key))}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-2">
                An unticked side stops at the signal gate. In the backtest, bull puts carried the edge; bear calls mostly did not.
              </p>
            </fieldset>

            <fieldset>
              <legend className={LABEL}>Days to expiration</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {shownDtes(draft.dtes).map((d) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={draft.dtes.includes(d)}
                      onChange={() => update("dtes", toggled(draft.dtes, d))}
                    />
                    {d}
                  </label>
                ))}
              </div>
              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addDte();
                }}
              >
                <label htmlFor="custom-dte" className={LABEL}>
                  Custom
                </label>
                <input
                  id="custom-dte"
                  type="number"
                  min={DTE_MIN}
                  max={DTE_MAX}
                  placeholder="30"
                  value={customDte}
                  onChange={(e) => setCustomDte(e.target.value)}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">days</span>
                <button type="submit" disabled={!canAddDte} className={ACTION_BUTTON}>
                  Add
                </button>
              </form>
              <p className="mt-1.5 text-xs text-ink-2">
                Any expiry from {DTE_MIN} to {DTE_MAX} days. The edge gate backtests each one you
                tick, so the first scan after adding one rebuilds that table.
              </p>
            </fieldset>
          </div>
        </Panel>

        <Panel title="Gates">
          <fieldset>
            <legend className={LABEL}>Gates each scan must pass</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
              {GATES.map((gate) => {
                const key = GATE_SWITCH[gate.stage];
                return (
                  <label key={gate.stage} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={key ? Boolean(draft[key]) : true}
                      disabled={!key}
                      onChange={(e) => key && update(key, e.target.checked)}
                    />
                    {gate.label}
                    {!key && <span className="text-xs text-ink-2">(always on)</span>}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-ink-2">
              A gate that is off is skipped and shows lighter in the scan table. Live trading
              always runs Risk limits and AI review.
            </p>
          </fieldset>
        </Panel>

        <Panel title="Backtest edge gate">
          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor="edge-min-n" className={LABEL}>
                Minimum trades
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="edge-min-n"
                  type="number"
                  min={0}
                  value={draft.edge_min_n}
                  onChange={(e) => update("edge_min_n", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">backtested trades per setup</span>
              </div>
            </div>

            <div>
              <label htmlFor="edge-min-expectancy" className={LABEL}>
                Minimum expectancy per trade
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="edge-min-expectancy"
                  type="number"
                  step="1"
                  value={draft.edge_min_expectancy}
                  onChange={(e) => update("edge_min_expectancy", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">dollars</span>
              </div>
            </div>
          </div>

          <h3 className="eyebrow mt-8 border-b border-rule pb-1 text-ink">Live preview</h3>
          {preview.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">
              No edge cells for these modes and expirations yet. The table builds on the engine's
              first cycle.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-1.5 pr-3">Mode</th>
                    <th className="num px-2 pb-1.5">Days to expiry</th>
                    <th className="px-2 pb-1.5 text-left">IV rank</th>
                    <th className="num px-2 pb-1.5">Trades</th>
                    <th className="num px-2 pb-1.5">Expectancy</th>
                    <th className="px-2 pb-1.5 text-left">Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((c) => {
                    const passes = wouldPass(c, draft.edge_min_n, draft.edge_min_expectancy);
                    return (
                      <tr key={`${c.mode}/${c.dte}/${c.bucket}`}>
                        <td className="py-2 pr-3 font-display text-base font-semibold text-ink">
                          {MODES.find((m) => m.key === c.mode)?.label ?? c.mode}
                        </td>
                        <td className="num px-2 py-2 text-ink-2">{c.dte}</td>
                        <td className="px-2 py-2 text-ink-2">{BUCKET_LABEL[c.bucket]}</td>
                        <td className="num px-2 py-2 text-ink-2">{c.n}</td>
                        <td className="num px-2 py-2 text-ink-2">
                          {formatMoney(c.expectancy, { signed: true })}
                        </td>
                        <td className="px-2 py-2">
                          {passes ? (
                            <StatusBadge tone="good" label="Would pass" />
                          ) : (
                            <StatusBadge tone="neutral" label="Would be blocked" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </Section>

      <Section icon={GATE_ICONS["Risk limits"]} label="Risk boundaries">
        <Panel title="Risk limits">
          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor="max-open" className={LABEL}>
                Maximum open positions
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="max-open"
                  type="number"
                  min={0}
                  value={draft.max_open_positions}
                  onChange={(e) => update("max_open_positions", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">positions</span>
              </div>
            </div>

            <div>
              <label htmlFor="max-risk" className={LABEL}>
                Maximum deployed risk
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="max-risk"
                  type="number"
                  step="1"
                  value={draft.max_deployed_risk}
                  onChange={(e) => update("max_deployed_risk", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">dollars</span>
              </div>
            </div>
            <RiskCap
              cap={draft.max_deployed_risk}
              deployed={deployed}
              onChange={(v) => update("max_deployed_risk", v)}
            />
          </div>
        </Panel>
      </Section>

      <Section icon={GATE_ICONS["AI review"]} label="Review & alerts">
        <Panel title="AI review">
          <div className="flex flex-col gap-6">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.ai_allow_caution}
                onChange={(e) => update("ai_allow_caution", e.target.checked)}
              />
              Allow "Caution" verdicts to alert
            </label>

            <Select
              id="ai-endpoint"
              label="API endpoint"
              value={endpointChoice}
              onChange={chooseEndpoint}
              options={[
                { value: "", label: "Not set — AI review off" },
                ...providers.map((p) => ({ value: p.url, label: p.label })),
                { value: CUSTOM, label: "Custom…" },
              ]}
              hint="Any Anthropic-compatible endpoint. Blank leaves the review off unless the environment names one."
            />

            {customEndpoint ? (
              <Field
                id="ai-endpoint-url"
                label="Custom endpoint URL"
                value={draft.ai_api_endpoint}
                onChange={(v) => update("ai_api_endpoint", v)}
                placeholder="https://…"
                hint="Any Anthropic-compatible endpoint. Its /v1/messages is what gets called."
              />
            ) : null}

            {customEndpoint ? (
              <Field
                id="ai-model"
                label="Model"
                value={draft.ai_model}
                onChange={(v) => update("ai_model", v)}
                placeholder="Model name"
                hint="The model name that endpoint expects."
              />
            ) : (
              <Select
                id="ai-model"
                label="Model"
                value={draft.ai_model}
                onChange={(v) => update("ai_model", v)}
                disabled={!provider}
                options={[
                  { value: "", label: "Not set — AI review off" },
                  ...(provider?.models ?? []).map((m) => ({ value: m.id, label: m.label })),
                ]}
                hint={
                  provider
                    ? `The models ${provider.label} serves.`
                    : "Choose an endpoint first, or name a model in the environment."
                }
              />
            )}

            <Field
              id="ai-key"
              label="API key"
              secret
              value={draft.ai_api_key}
              onChange={(v) => update("ai_api_key", v)}
              placeholder="Not set"
              hint={keyHint}
            />
          </div>
        </Panel>

        <Panel title="Alerts">
          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor="cooldown-hours" className={LABEL}>
                Don't repeat the same alert within
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="cooldown-hours"
                  type="number"
                  min={0}
                  value={draft.alert_cooldown_hours}
                  onChange={(e) => update("alert_cooldown_hours", Number(e.target.value))}
                  className={NUMBER}
                />
                <span className="text-sm text-ink-2">hours</span>
              </div>
            </div>

            <Field
              id="telegram-token"
              label="Telegram bot token"
              secret
              value={draft.telegram_bot_token}
              onChange={(v) => update("telegram_bot_token", v)}
              placeholder="Not set"
              hint="From @BotFather. Saved masked, the same as the AI key."
            />

            <Field
              id="telegram-chat"
              label="Telegram chat ID"
              value={draft.telegram_chat_id}
              onChange={(v) => update("telegram_chat_id", v)}
              placeholder="Not set"
              hint="The chat alerts are posted into. No token, no chat ID, no alerts."
            />
          </div>
        </Panel>
      </Section>

      <Section icon={SCREEN_ICONS.settings} label="Appearance">
        <Panel title="Design">
          <div className="flex flex-col">
            {TEMPLATES.map((t) => {
              const active = template === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTemplate(t.id)}
                  className="flex items-center gap-4 border-b border-rule py-2.5 text-left last:border-0"
                >
                  <span
                    data-template={t.id}
                    data-theme={theme}
                    aria-hidden="true"
                    className={`flex h-12 w-20 shrink-0 flex-col border border-rule-strong bg-paper p-1.5 ${
                      active ? "" : "opacity-50"
                    }`}
                  >
                    {PREVIEW[t.id]}
                  </span>
                  <span className="flex flex-1 items-baseline justify-between gap-4">
                    <span
                      className={`font-display text-[17px] font-semibold ${
                        active ? "text-ink" : "text-ink-2"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className={`eyebrow ${active ? "text-ink" : "text-ink-2"}`}>
                      {active ? "Active" : "Use"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-sm text-ink-2">
            Templates change the look only — the engine, the gates and the book are the same in all of
            them. Kept in this browser, like the light or dark edition.
          </p>
        </Panel>
      </Section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t-2 border-ink bg-paper py-3">
        {saveError ? (
          <p className="mr-auto text-sm text-critical">{saveError}</p>
        ) : (
          count > 0 && (
            <p className="mr-auto text-sm text-ink-2">
              {count} unsaved {count === 1 ? "change" : "changes"}
            </p>
          )
        )}

        {confirming ? (
          <div className="flex gap-2">
            <button type="button" onClick={restore} disabled={busy} className={CONFIRM_BUTTON}>
              Confirm restore defaults
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className={ACTION_BUTTON}
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className={ACTION_BUTTON}
          >
            Restore defaults
          </button>
        )}

        <button
          type="button"
          onClick={save}
          disabled={count === 0 || busy}
          className={PRIMARY_BUTTON}
        >
          Save settings
        </button>
      </div>
    </div>
  );
}