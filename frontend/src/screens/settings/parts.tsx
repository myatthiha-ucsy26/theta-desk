import { useEffect, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { api, type BotStatus, type Settings as SettingsData } from "@/lib/infra/api";
import { useTemplate, type TemplateId } from "@/lib/infra/templates";
import { marketHours } from "@/lib/infra/time";
import { formatMoney } from "@/lib/domain/views";
import { INPUT, LABEL } from "@/lib/infra/ui";

const WIDE = `w-full ${INPUT}`;

// The slider's own granularity, and the range it spans before the top follows the cap upward. Both
// are properties of the control rather than claims about the desk, which is why the typed field
// stays the one that holds the exact number.
const RISK_STEP = 100;
const RISK_RANGE = 10000;

/**
 * A labelled credential field, with the line that says what leaving it blank does.
 *
 * A secret is typed masked and comes back from the server masked, so the field never holds the
 * real value: typing over it replaces the stored one, and clearing it removes one.
 */
export function Field({
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
export function Select({
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
export function Stat({ label, value }: { label: string; value: ReactNode }) {
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
export function Section({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
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
export function PageHead({ saved, count }: { saved: SettingsData; count: number }) {
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

/**
 * The hard cap, drawn as the cap rather than as a number in a box: the slider sets it, the field
 * beside it types it exactly, and the bar underneath says how much of it the book has spent.
 *
 * The allocated side is real — it is what the paper book holds right now — and the bar only means
 * something as a pair, so both numbers are shown against the one cap.
 */
export function RiskCap({
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
export function BotSlots({ cap }: { cap: number }) {
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

// A miniature of each template, drawn from the same tokens as the app — so the thumb tells the
// truth in either edition, and can never go stale the way a screenshot would. The frame it is
// drawn in carries the template's own id and the current edition, which is what scopes the
// tokens: each thumb shows its own colours even while another template is the active one.
export const PREVIEW: Record<TemplateId, ReactNode> = {
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
