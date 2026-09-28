import { TONE } from "@/components/shared/Metric";
import { useTemplate } from "@/lib/infra/templates";
import type { Exposure } from "@/lib/domain/manage";
import { formatMoney, formatPct } from "@/lib/domain/views";

/**
 * The live book as tiles, each carrying the reading that qualifies its figure.
 *
 * Six of the nine rows Minimal used to rule off are the same reading twice: open spreads is the
 * count under credit deployed, wins / losses is the pair under win rate, credit captured is what
 * the unrealised P&L is earned against. Realised P&L has no second reading to sit under, so it
 * keeps a tile of its own rather than being dropped for being the odd one out.
 */
export function ExposureTiles({ totals }: { totals: Exposure }) {
  // In the terminal this panel is one column of the cockpit rather than the width of the page, so
  // the five tiles wrap onto a second row instead of being squeezed to fit one. The breakpoints
  // are the viewport's, which is why the rail can be beside them at all.
  const minimal = useTemplate() === "minimal";
  return (
    <dl
      className={`mt-5 grid grid-cols-2 gap-3 min-[900px]:grid-cols-3 ${
        minimal ? "" : "min-[1300px]:grid-cols-5"
      }`}
    >
      <StatTile
        label="Credit deployed"
        value={formatMoney(totals.credit, { signed: false })}
        sub={`${totals.count} active ${totals.count === 1 ? "contract" : "contracts"}`}
      />
      <StatTile
        label="Margin committed"
        value={formatMoney(totals.margin, { signed: false })}
        sub={`NAV usage ${formatPct(totals.navPct)}`}
      />
      <StatTile
        label="Unrealised P&L"
        value={formatMoney(totals.unrealized, { signed: true })}
        tone={totals.unrealized > 0 ? "profit" : totals.unrealized < 0 ? "loss" : "muted"}
        sub={`${formatPct(totals.capturedPct)} of credit captured`}
      />
      <StatTile
        label="Realised P&L"
        value={formatMoney(totals.realized, { signed: true })}
        tone={totals.realized > 0 ? "profit" : totals.realized < 0 ? "loss" : "muted"}
        sub={`${totals.wins + totals.losses} closed`}
      />
      <StatTile
        label="Win rate"
        value={formatPct(totals.winRate * 100)}
        sub={`${totals.wins} / ${totals.losses} closed`}
      />
    </dl>
  );
}

/** A figure with its label above and the reading that explains it below. */
export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="stat-card flex min-w-0 flex-col">
      <dt className="eyebrow">{label}</dt>
      <dd className={`figure mt-0.5 truncate ${tone ? TONE[tone] : "text-ink"}`}>{value}</dd>
      <dd className="stat-sub mt-0.5">{sub}</dd>
    </div>
  );
}
