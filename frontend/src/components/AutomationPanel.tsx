import { useEffect, useState } from "react";
import { accountBadge } from "../lib/account";
import { api, type AccountMode, type BotStatus, type PreflightCheck, type Settings } from "../lib/api";
import { slotProgress } from "../lib/bot";
import { announceSettingsSaved } from "../lib/settingsBus";
import { useTemplate } from "../lib/templates";
import { Panel } from "./Panel";
import { StatusBadge } from "./StatusBadge";
import { toast } from "../lib/toast";
import { BTN, BTN_DANGER, INPUT, LABEL } from "../lib/ui";

const NUMBER = `w-28 ${INPUT}`;

type Editable = "tp_pct" | "sl_multiple" | "min_credit";
const FIELDS: { key: Editable; label: string; step: number }[] = [
  { key: "tp_pct", label: "Take profit (% of credit kept)", step: 5 },
  { key: "sl_multiple", label: "Stop loss (× credit lost)", step: 0.5 },
  { key: "min_credit", label: "Minimum credit ($ per share)", step: 0.05 },
];

/**
 * Which account the bot trades, and whether it is running.
 *
 * The two are deliberately separate controls. Running the bot on paper costs
 * nothing and asks for nothing; running it on the live account is what takes a
 * typed confirmation and a green pre-flight. Conflating them would mean either
 * ceremony to test, or no ceremony to trade.
 */
export function AutomationPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minimal = useTemplate() === "minimal";

  useEffect(() => {
    let live = true;
    Promise.all([api.settings(), api.bot(), api.botPreflight()])
      .then(([s, b, p]) => {
        if (!live) return;
        setSettings(s);
        setBot(b);
        setChecks(p.checks);
        setReady(p.ready);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  async function save(updates: Partial<Settings> & { confirm?: string }) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveSettings(updates);
      setSettings(next);
      toast(
        updates.account_mode ? `Switched to the ${updates.account_mode} account`
        : updates.mode === "auto" ? "Bot started"
        : updates.mode === "manual" ? "Bot stopped"
        : "Automation saved",
      );
      setTyped("");
      // The header's bot badge reads its own copy of mode; don't let it say "Bot off".
      announceSettingsSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return <Panel title="Automation">{error ? <p className="text-sm text-critical">{error}</p> : <p className="text-sm text-ink-2">Loading…</p>}</Panel>;
  }
  const auto = settings.mode === "auto";
  const account: AccountMode = settings.account_mode;
  const live = account === "live";
  const badge = accountBadge(account);
  // Pre-flight only gates the live account; on paper it reports its broker checks as
  // not required, and the bot needs nothing but quotes.
  const canStart = !live || (ready && typed === "LIVE");

  return (
    <Panel title="Automation">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-2">
          <span className={LABEL}>Account</span>
          <p><StatusBadge tone={badge.tone} label={badge.label} /></p>
          <p className="text-xs text-ink-2">{badge.hint}</p>
          {live ? (
            <button type="button" disabled={busy}
              onClick={() => save({ account_mode: "paper" })}
              className={`${BTN} self-start`}>
              Switch to the paper account
            </button>
          ) : (
            <button type="button" disabled={busy}
              onClick={() => save({ account_mode: "live" })}
              className={`${BTN} self-start`}>
              Switch to the live account
            </button>
          )}
        </div>

        <hr className="border-rule" />

        <p className="text-ink">
          {auto
            ? <StatusBadge tone={live ? "warn" : "good"} label={live ? "Trading live" : "Paper bot running"} />
            : <StatusBadge tone="neutral" label="Bot stopped" />}
        </p>
        <p className="text-ink-2">5-wide spreads · 1 contract · AI must CONFIRM</p>
        {bot && !minimal && <p className="text-ink-2">{slotProgress(bot)}</p>}

        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className={LABEL}>{f.label}</span>
              <input type="number" step={f.step} className={NUMBER} defaultValue={settings[f.key]}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== settings[f.key]) void save({ [f.key]: v });
                }} />
            </label>
          ))}
        </div>

        {auto ? (
          <button type="button" disabled={busy} onClick={() => save({ mode: "manual" })}
            className={`${BTN} self-start`}>
            Stop the bot
          </button>
        ) : live ? (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1">
              {checks.map((c) => (
                <li key={c.name}>
                  <StatusBadge tone={c.ok ? "good" : "critical"} label={c.ok ? c.name : `${c.name}: ${c.detail || "not ready"}`} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-2">
              Places real orders on your moomoo account. Your existing positions are never touched.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Type LIVE to confirm</span>
                <input className={NUMBER} value={typed} onChange={(e) => setTyped(e.target.value)} />
              </label>
              <button type="button" disabled={busy || !canStart}
                onClick={() => save({ mode: "auto", confirm: "LIVE" })}
                className={BTN_DANGER}>
                Start live trading
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-2">
              Fills are simulated from live quotes. Nothing reaches your account.
            </p>
            <button type="button" disabled={busy} onClick={() => save({ mode: "auto" })}
              className={`${BTN} self-start`}>
              Start the paper bot
            </button>
          </div>
        )}
        {error && <p className="text-sm text-critical">{error}</p>}
      </div>
    </Panel>
  );
}
