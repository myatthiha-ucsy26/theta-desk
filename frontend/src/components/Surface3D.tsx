import { Suspense, lazy, useMemo, useState } from "react";
import { gridToMesh, type Grid } from "../lib/surface";
import { GridTable } from "./GridTable";

import { BTN } from "../lib/ui";

// three.js is heavy and only a surface view needs it, so the canvas arrives on demand.
const SurfaceCanvas = lazy(() => import("./SurfaceCanvas"));

export interface Surface3DProps {
  grid: Grid;
  rowLabels: string[];
  colLabels: string[];
  rowTitle: string;
  colTitle: string;
  valueTitle: string;
  colorFor: (normalized: number, raw: number) => string;
  formatValue: (raw: number) => string;
  markers?: { col?: number; label: string }[];
}

/**
 * A value grid drawn as a surface, with the same grid always reachable as a table.
 * The canvas is the only thing that needs a GPU; everything around it does not.
 */
export function Surface3D(props: Surface3DProps) {
  const { grid, rowLabels, colLabels, colorFor, formatValue, markers = [] } = props;
  const mesh = useMemo(() => gridToMesh(grid), [grid]);
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null);
  const [asTable, setAsTable] = useState(false);

  if (!mesh) return <p className="text-sm text-ink-2">Not enough data to draw a surface.</p>;

  const named = markers.filter((m) => m.col !== undefined);

  const raw = cell ? grid[cell.row]?.[cell.col] ?? null : null;
  const tooltip = cell
    ? `${props.colTitle} ${colLabels[cell.col] ?? cell.col}, ${props.rowTitle} ${rowLabels[cell.row] ?? cell.row}: ${
        raw === null ? "—" : formatValue(raw)
      }`
    : null;

  return (
    <div>
      <div className="relative h-[380px] overflow-hidden border border-rule-strong bg-well">
        {asTable ? (
          <div className="h-full overflow-auto p-3">
            <GridTable
              grid={grid}
              rowLabels={rowLabels}
              colLabels={colLabels}
              formatValue={formatValue}
            />
          </div>
        ) : (
          <>
            <Suspense fallback={<p className="p-4 text-sm text-ink-2">Loading surface…</p>}>
              <SurfaceCanvas
                mesh={mesh}
                rowLabels={rowLabels}
                colLabels={colLabels}
                colorFor={colorFor}
                markers={markers}
                onHover={setCell}
              />
            </Suspense>
            {tooltip && (
              <p className="pointer-events-none absolute left-3 top-3 border border-rule-strong bg-sheet/95 px-2 py-1 text-[11px] tabular-nums text-ink">
                {tooltip}
              </p>
            )}
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Names the dots on the surface. They live out here rather than in the scene: the
            marks for spot, short strike and breakeven fall within a few pixels of each other,
            so anything written beside them in three.js space piles up unreadably. */}
        {named.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
            {named.map((m) => (
              <li key={m.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink" />
                {m.label}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className={BTN}
        >
          {asTable ? "Show as surface" : "Show as table"}
        </button>
      </div>
    </div>
  );
}