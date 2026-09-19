// Turns a value grid (rows x columns, may contain nulls) into triangle-mesh arrays
// for three.js. Used by both 3D views: IV surface (rows = expirations, columns =
// strikes) and payoff surface (rows = days left, columns = spot prices).

export type Grid = (number | null)[][];

export interface Mesh {
  positions: Float32Array; // x, y (height), z per vertex; x,z in [-1,1], y in [0,1]
  indices: Uint32Array;
  values: Float32Array; // height per vertex in [0,1], for colouring
  min: number;
  max: number;
  rows: number;
  cols: number;
}

/** Fill nulls from the nearest known cell in the row; empty rows copy the nearest non-empty row. */
export function fillGaps(grid: Grid): number[][] {
  const rows: (number[] | null)[] = grid.map((row) => {
    const known = row.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][];
    if (!known.length) return null;
    return row.map((v, i) => {
      if (v !== null) return v;
      let best = known[0];
      for (const k of known) if (Math.abs(k[1] - i) < Math.abs(best[1] - i)) best = k;
      return best[0];
    });
  });
  if (rows.every((r) => r === null)) return [];
  return rows.map((row, i) => {
    if (row) return row;
    for (let d = 1; ; d++) {
      if (rows[i - d]) return [...rows[i - d]!];
      if (rows[i + d]) return [...rows[i + d]!];
    }
  });
}

export function gridToMesh(grid: Grid): Mesh | null {
  const z = fillGaps(grid);
  const rows = z.length;
  const cols = rows ? z[0].length : 0;
  if (rows < 2 || cols < 2) return null;
  const flat = z.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const span = max - min || 1;

  const positions = new Float32Array(rows * cols * 3);
  const values = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const t = (z[r][c] - min) / span;
      positions[k * 3] = (c / (cols - 1)) * 2 - 1;
      positions[k * 3 + 1] = t;
      positions[k * 3 + 2] = (r / (rows - 1)) * 2 - 1;
      values[k] = t;
    }
  }
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let p = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      indices.set([a, d, b, b, d, e], p);
      p += 6;
    }
  }
  return { positions, indices, values, min, max, rows, cols };
}
