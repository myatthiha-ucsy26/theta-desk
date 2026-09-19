import type { IvSurface, Spread } from "../lib/api";
import { smileReadings, smileRows, type SmileTag } from "../lib/smile";
import { formatStrike } from "../lib/views";

const TAG_LABEL: Record<SmileTag, string> = { short: "S", long: "L", atm: "ATM" };
const TAG_CHIP: Record<SmileTag, string> = {
  short: "bg-profit text-sheet",
  long: "bg-loss text-sheet",
  atm: "border border-rule-strong text-ink-2",
};
const TAG_TINT: Record<SmileTag, string> = {
  short: "bg-profit/10",
  long: "bg-loss/10",
  atm: "bg-well",
};

/** The same surface as the mesh above, read as a table: strikes down, expirations across. */
export function SmileTable({
  surface,
  spread,
  dte,
}: {
  surface: IvSurface;
  /** The studied spread, when there is one: its two strikes are what the rows are tagged for. */
  spread?: Spread | null;
  /** The DTE being studied. The nearest expiry the surface holds is the one picked out. */
  dte: number;
}) {
  const rows = smileRows(surface, spread);
  const { dte: at, skew, richest } = smileReadings(surface, dte);
  const asIv = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;

  return (
    <figure className="flex flex-col gap-2">
      <div className="max-h-80 overflow-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left">Strike</th>
              {surface.dtes.map((d) => (
                <th key={d} className={`px-2 py-1.5 text-center ${d === at ? "text-accent" : ""}`}>
                  {d} DTE
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.strike} className={row.tag ? TAG_TINT[row.tag] : ""}>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5 font-display text-sm font-semibold tabular-nums text-ink">
                    {formatStrike(row.strike)}
                    {row.tag && (
                      <span
                        className={`px-1 text-[10px] font-semibold tracking-[0.06em] ${TAG_CHIP[row.tag]}`}
                      >
                        {TAG_LABEL[row.tag]}
                      </span>
                    )}
                  </span>
                </td>
                {row.iv.map((v, i) => (
                  <td
                    key={surface.dtes[i]}
                    className={`px-2 py-1.5 text-center tabular-nums ${
                      surface.dtes[i] === at ? "font-semibold text-ink" : "text-ink-2"
                    }`}
                  >
                    {asIv(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule pt-2">
        <span className="flex items-baseline gap-1.5">
          <span className="eyebrow">Skew</span>
          <span className="font-display text-sm font-semibold tabular-nums text-ink">
            {skew === null ? "—" : signed(skew)}
          </span>
          {skew !== null && (
            <span className="text-xs text-ink-2">{skew >= 0 ? "put wing rich" : "call wing rich"}</span>
          )}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="eyebrow">Richest term</span>
          <span className="font-display text-sm font-semibold tabular-nums text-ink">
            {richest ? `${richest.dte}D` : "—"}
          </span>
          {richest && <span className="text-xs tabular-nums text-ink-2">{asIv(richest.iv)}</span>}
        </span>
      </figcaption>
    </figure>
  );
}