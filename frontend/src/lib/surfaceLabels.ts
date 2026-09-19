// Label and hit-testing helpers for the 3D surfaces. Pure: no three.js here.

/** The mesh lays a grid over x,z in [-1, 1]; this is that mapping read backwards. */
function axis(v: number, n: number): number {
  if (n < 2) return 0;
  const i = Math.round(((v + 1) / 2) * (n - 1));
  return Math.min(n - 1, Math.max(0, i));
}

/** The cell under a point on the mesh. x runs across columns, z down rows. */
export function nearestCell(x: number, z: number, rows: number, cols: number): { row: number; col: number } {
  return { row: axis(z, rows), col: axis(x, cols) };
}

/**
 * The index of the value closest to `target`, or -1 on an empty axis.
 * Ties keep the lower index, so a marker between two strikes picks the nearer-to-spot one.
 */
export function nearestIndex(values: number[], target: number): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (best === -1 || Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  }
  return best;
}