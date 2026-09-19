import { describe, expect, it } from "vitest";
import { fillGaps, gridToMesh } from "./surface";

describe("fillGaps", () => {
  it("fills a missing cell from its nearest neighbour in the same row", () => {
    expect(fillGaps([[1, null, null, 4]])).toEqual([[1, 1, 4, 4]]);
  });

  it("copies the nearest complete row when a whole row is empty", () => {
    expect(fillGaps([[1, 2], [null, null], [5, 6]])).toEqual([[1, 2], [1, 2], [5, 6]]);
  });

  it("returns an empty grid when nothing is known", () => {
    expect(fillGaps([[null, null]])).toEqual([]);
  });
});

describe("gridToMesh", () => {
  const z = [[0.2, 0.3, 0.4], [0.25, null, 0.45]];
  const mesh = gridToMesh(z)!;

  it("makes one vertex per cell and two triangles per quad", () => {
    expect(mesh.positions.length).toBe(2 * 3 * 3);
    expect(mesh.indices.length).toBe(6 * (2 - 1) * (3 - 1));
  });

  it("normalises x and z to [-1, 1] and height to [0, 1]", () => {
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      xs.push(mesh.positions[i]); ys.push(mesh.positions[i + 1]); zs.push(mesh.positions[i + 2]);
    }
    expect(Math.min(...xs)).toBe(-1); expect(Math.max(...xs)).toBe(1);
    expect(Math.min(...zs)).toBe(-1); expect(Math.max(...zs)).toBe(1);
    expect(Math.min(...ys)).toBeCloseTo(0); expect(Math.max(...ys)).toBeCloseTo(1);
  });

  it("exposes normalised values for colouring, one per vertex", () => {
    expect(mesh.values.length).toBe(6);
    expect(Math.min(...mesh.values)).toBeCloseTo(0);
    expect(Math.max(...mesh.values)).toBeCloseTo(1);
  });

  it("returns null when the grid is too small to draw a surface", () => {
    expect(gridToMesh([[0.2, 0.3]])).toBeNull();
    expect(gridToMesh([])).toBeNull();
  });
});
