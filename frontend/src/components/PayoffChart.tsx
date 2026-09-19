import type { Spread } from "../lib/api";
import { payoffCurve, payoffLevels } from "../lib/payoff";
import { formatMoney } from "../lib/views";

// Fixed geometry so the chart reads the same in every row; the panel scales it to its width.
const W = 320;
const H = 96;
const PAD = 6;

/**
 * The trade at expiry: profit to the right of the breakeven, loss to the left. The two regions are
 * filled apart because colour alone would not carry it — the levels are printed underneath, and
 * the whole figure is described for a screen reader.
 */
export function PayoffChart({ spread, spot }: { spread: Spread; spot?: number | null }) {
  const { lo, hi, maxProfit, maxLoss, breakeven, profitAbove } = payoffLevels(spread, spot);
  const curve = payoffCurve(spread, 60, lo, hi);

  const span = maxProfit + maxLoss || 1;
  const x = (v: number) => ((v - lo) / (hi - lo)) * W;
  const y = (pnl: number) => PAD + (1 - (pnl + maxLoss) / span) * (H - 2 * PAD);

  const line = curve.map((p, i) => `${i ? "L" : "M"} ${x(p.spot).toFixed(2)} ${y(p.pnl).toFixed(2)}`).join(" ");
  // Closing the curve down to the zero line makes the fill the profit-or-loss region itself.
  const region = `${line} L ${W} ${y(0).toFixed(2)} L 0 ${y(0).toFixed(2)} Z`;
  const zero = y(0);

  return (
    <figure className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Expiry payoff per contract: ${profitAbove ? "profit" : "loss"} above the breakeven, best ${formatMoney(maxProfit)}, worst ${formatMoney(-maxLoss)}, breakeven ${formatMoney(breakeven, { signed: false })}.`}
        className="h-auto w-full"
      >
        <defs>
          <clipPath id="payoff-up">
            <rect x="0" y="0" width={W} height={zero} />
          </clipPath>
          <clipPath id="payoff-down">
            <rect x="0" y={zero} width={W} height={Math.max(H - zero, 0)} />
          </clipPath>
        </defs>

        <path d={region} className="fill-profit/20" clipPath="url(#payoff-up)" />
        <path d={region} className="fill-loss/20" clipPath="url(#payoff-down)" />
        <path d={line} fill="none" className="stroke-ink" strokeWidth="1.25" />

        <line x1="0" x2={W} y1={zero} y2={zero} className="stroke-rule-strong" strokeWidth="1" />

        <line
          x1={x(breakeven)}
          x2={x(breakeven)}
          y1={PAD}
          y2={H - PAD}
          className="stroke-accent"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        {typeof spot === "number" && spot > 0 && (
          <line
            x1={x(spot)}
            x2={x(spot)}
            y1={PAD}
            y2={H - PAD}
            className="stroke-ink-2"
            strokeWidth="1"
            strokeDasharray="1 2"
          />
        )}
      </svg>

      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-ink-2">
        <span className="tabular-nums">
          Worst {formatMoney(-maxLoss)}{" "}
          <span className="text-accent">·</span> breakeven {formatMoney(breakeven, { signed: false })}
        </span>
        <span className="tabular-nums">Best {formatMoney(maxProfit)}</span>
      </figcaption>
    </figure>
  );
}