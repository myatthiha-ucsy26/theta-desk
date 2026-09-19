// The same grid the 3D view draws, as a table. Every 3D view has one, so the
// numbers stay reachable without WebGL, without a mouse, and by screen readers.

export function GridTable({ grid, rowLabels, colLabels, formatValue }: {
  grid: (number | null)[][];
  rowLabels: string[];
  colLabels: string[];
  formatValue: (raw: number) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="pb-1.5" />
            {colLabels.map((label, c) => (
              <th key={`${label}-${c}`} className="num px-2 pb-1.5">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={`${rowLabels[r] ?? r}-${r}`} className="border-b border-rule last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">
                {rowLabels[r] ?? r}
              </th>
              {row.map((v, c) => (
                <td key={c} className="num px-2 py-1.5 text-ink">
                  {v === null ? "—" : formatValue(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}