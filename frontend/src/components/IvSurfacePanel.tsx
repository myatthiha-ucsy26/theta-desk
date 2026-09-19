import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type IvSurface, type Spread } from "../lib/api";
import { PALETTES, sequentialColor } from "../lib/colors";
import { nearestIndex } from "../lib/surfaceLabels";
import { useTheme } from "../lib/theme";
import { Panel } from "./Panel";
import { SmileTable } from "./SmileTable";
import { StatusBadge } from "./StatusBadge";
import { Surface3D } from "./Surface3D";
import { BTN } from "../lib/ui";

/** Where premium is rich, across strikes and expirations: the ivrich thesis, made visible. */
export function IvSurfacePanel({
  ticker,
  spread,
  dte = 0,
}: {
  ticker: string;
  /** The spread being studied, when there is one: its legs tag the table's rows. */
  spread?: Spread | null;
  /** The DTE being studied. Cold, the shortest expiry the surface holds is the one read. */
  dte?: number;
}) {
  const [data, setData] = useState<IvSurface | null>(null);
  const [error, setError] = useState<{ msg: string; checkOpenD: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const ramp = PALETTES[theme].sequential;

  const load = useCallback(
    async (refresh: boolean) => {
      setBusy(true);
      setError(null);
      try {
        setData(await api.ivSurface(ticker, refresh));
      } catch (e) {
        setError({
          msg: e instanceof Error ? e.message : String(e),
          checkOpenD: e instanceof ApiError && e.status === 502,
        });
      } finally {
        setBusy(false);
      }
    },
    [ticker],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const asIv = (v: number) => `${(v * 100).toFixed(1)}%`;
  const spotCol = data ? nearestIndex(data.strikes, data.spot) : -1;

  return (
    <Panel
      title="Implied volatility"
      actions={
        <button type="button" disabled={busy} onClick={() => load(true)} className={BTN}>
          Refresh
        </button>
      }
    >
      {error && (
        <>
          <p className="flex flex-wrap items-baseline gap-2 text-sm">
            <StatusBadge tone="critical" label="Market data unavailable" />
            <span className="text-ink">{error.msg}</span>
          </p>
          {error.checkOpenD && (
            <p className="mt-1 text-sm text-ink-2">Check that OpenD is running, then refresh.</p>
          )}
        </>
      )}

      {data && (
        <>
          <p className="eyebrow mb-3">
            Nearest {data.expiries.length} expirations, strikes within 10% of spot
          </p>
          <Surface3D
            grid={data.iv}
            rowLabels={data.dtes.map((d) => `${d}d`)}
            colLabels={data.strikes.map((k) => String(k))}
            rowTitle="expiry"
            colTitle="strike"
            valueTitle="IV"
            colorFor={(t) => sequentialColor(t, theme)}
            formatValue={asIv}
            markers={spotCol >= 0 ? [{ col: spotCol, label: "Spot" }] : []}
          />
          {data.min_iv !== null && data.max_iv !== null && (
            <div className="mt-3 flex items-center gap-3">
              <span className="eyebrow">IV {asIv(data.min_iv)}</span>
              <span
                aria-hidden="true"
                className="h-2 flex-1 border border-rule"
                style={{
                  background: `linear-gradient(to right, ${ramp[0]}, ${ramp[ramp.length - 1]})`,
                }}
              />
              <span className="eyebrow">{asIv(data.max_iv)}</span>
            </div>
          )}

          {data.strikes.length > 0 && (
            <div className="mt-5 border-t border-rule pt-4">
              <p className="eyebrow mb-2">IV smile × term structure</p>
              <SmileTable surface={data} spread={spread} dte={dte} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}