import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Direction, type PayoffGrid } from "../lib/api";
import { PALETTES, divergingColor } from "../lib/colors";
import { greeks, nowPnl, stressRow } from "../lib/greeks";
import { nearestIndex } from "../lib/surfaceLabels";
import { useTheme } from "../lib/theme";
import { formatMoney, formatPreciseMoney, formatShares, spreadLabel } from "../lib/views";
import { Metric } from "./Metric";
import { Panel } from "./Panel";
import { StatusBadge } from "./StatusBadge";
import { Surface3D } from "./Surface3D";

/**
 * One vol point of IV, in decimal. The bump has to clear the pricer's own rounding: the grid is
 * quoted in cents, and a difference of two grids priced a hair apart would be all rounding noise.
 */
const VOL_BUMP = 0.01;

const MINUS = "−";

export interface PayoffSurfacePanelProps {
  direction: Direction;
  shortStrike: number;
  longStrike: number;
  credit: number;
  contracts: number;
  expiry: string;
  ticker: string;
}

/**
 * P&L across spot and days remaining, from the same pricer the paper book uses.
 * The time value the old code ignored is the shelf between the top row and the last one.
 */
export function PayoffSurfacePanel({
  direction,
  shortStrike,
  longStrike,
  credit,
  contracts,
  expiry,
  ticker,
}: PayoffSurfacePanelProps) {
  const [data, setData] = useState<PayoffGrid | null>(null);
  const [bumped, setBumped] = useState<{ up: number; down: number } | null>(null);
  const [error, setError] = useState<{ msg: string; checkOpenD: boolean } | null>(null);
  const theme = useTheme();
  const { loss, mid, profit, gainPivot } = PALETTES[theme];

  const load = useCallback(async () => {
    setError(null);
    setBumped(null);
    try {
      const body = {
        direction,
        short_strike: shortStrike,
        long_strike: longStrike,
        credit,
        contracts,
        expiry,
        ticker,
      };
      const grid = await api.payoff(body);
      setData(grid);
      // Vega is a second difference of this same pricer, so it needs the vol the grid was priced
      // at -- which only the grid itself knows, hence the second round trip. Both bumps pin the
      // spot the first call returned: /api/payoff re-fetches it otherwise, and a tick between
      // calls would shift the grid's own columns out from under the difference. Best effort: a
      // bump that fails costs one greek, not the panel, so it is caught here and dropped.
      try {
        const pinned = { ...body, spot: grid.spot };
        const [up, down] = await Promise.all([
          api.payoff({ ...pinned, sigma: grid.sigma + VOL_BUMP }),
          api.payoff({ ...pinned, sigma: grid.sigma - VOL_BUMP }),
        ]);
        setBumped({ up: nowPnl(up), down: nowPnl(down) });
      } catch {
        /* leave vega unread */
      }
    } catch (e) {
      setError({
        msg: e instanceof Error ? e.message : String(e),
        checkOpenD: e instanceof ApiError && e.status === 502,
      });
    }
  }, [direction, shortStrike, longStrike, credit, contracts, expiry, ticker]);

  useEffect(() => {
    void load();
  }, [load]);

  const g = data ? greeks(data, bumped ? { ...bumped, step: VOL_BUMP } : undefined) : null;
  const stress = data ? stressRow(data) : [];

  const marks = data
    ? [
        { col: nearestIndex(data.spots, data.spot), label: "Spot" },
        { col: nearestIndex(data.spots, shortStrike), label: "Short" },
        { col: nearestIndex(data.spots, data.breakeven), label: "Breakeven" },
      ].filter((m) => m.col >= 0)
    : [];

  return (
    <Panel title="Payoff over time">
      {error && (
        <>
          <p className="flex flex-wrap items-baseline gap-2 text-sm">
            <StatusBadge tone="critical" label="Payoff unavailable" />
            <span className="text-ink">{error.msg}</span>
          </p>
          {error.checkOpenD && (
            <p className="mt-1 text-sm text-ink-2">Check that OpenD is running, then refresh.</p>
          )}
        </>
      )}

      {data && (
        <>
          <p className="mb-3 font-display text-[15px] text-ink">
            {spreadLabel(direction)} {formatMoney(shortStrike, { signed: false })}/
            {formatMoney(longStrike, { signed: false })}, {contracts} contract
            {contracts === 1 ? "" : "s"}
          </p>
          <Surface3D
            grid={data.pnl}
            rowLabels={data.days.map((d) => (d === 0 ? "Expiry" : `${d} days`))}
            colLabels={data.spots.map((s) => formatMoney(s, { signed: false }))}
            rowTitle="days left"
            colTitle="spot"
            valueTitle="P&L"
            colorFor={(_, raw) => divergingColor(raw, Math.max(data.max_profit, -data.max_loss), theme)}
            formatValue={(v) => formatMoney(v)}
            markers={marks}
          />
          <div className="mt-3">
            <div className="flex items-center gap-3">
              <span className="eyebrow">
                Max loss {formatMoney(data.max_loss, { signed: false })}
              </span>
              <span
                aria-hidden="true"
                className="h-2 flex-1 border border-rule"
                style={{
                  background: `linear-gradient(to right, ${loss}, ${mid}, ${gainPivot}, ${profit})`,
                }}
              />
              <span className="eyebrow">
                Max profit {formatMoney(data.max_profit, { signed: false })}
              </span>
            </div>
            <p className="mt-1 text-center text-xs text-ink-2">0</p>
          </div>

          {g && (
            <div className="mt-4 border-t border-rule pt-3">
              <p className="eyebrow">
                Sensitivities at {formatMoney(data.spot, { signed: false })} — differences of the
                surface above, not a second model
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
                <Metric label="Delta · shares" value={formatShares(g.delta)} />
                <Metric label="Gamma · shares per $1" value={formatShares(g.gamma)} />
                <Metric
                  label="Theta · per day"
                  value={formatPreciseMoney(g.theta)}
                  tone={g.theta > 0 ? "profit" : g.theta < 0 ? "loss" : undefined}
                />
                <Metric
                  label="Vega · per vol point"
                  value={g.vega === null ? "—" : formatPreciseMoney(g.vega)}
                />
              </dl>
              {g.vega === null && (
                <p className="mt-1 text-xs text-ink-2">
                  Vega is unread: the bumped grids did not come back.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-rule pt-3">
            <p className="eyebrow">Spot stress — today's row, five shifts</p>
            <dl className="mt-2 grid grid-cols-5 gap-x-3 gap-y-1">
              {stress.map((s) => (
                <Metric
                  key={s.shiftPct}
                  label={s.shiftPct === 0 ? "Now" : `${s.shiftPct > 0 ? "+" : MINUS}${Math.abs(s.shiftPct)}%`}
                  value={formatMoney(s.pnl, { signed: true })}
                  tone={s.pnl > 0 ? "profit" : s.pnl < 0 ? "loss" : "muted"}
                />
              ))}
            </dl>
          </div>
        </>
      )}
    </Panel>
  );
}