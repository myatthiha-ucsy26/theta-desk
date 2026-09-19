import { describe, expect, it } from "vitest";
import { nearestCell, nearestIndex } from "./surfaceLabels";

describe("nearestCell", () => {
  it("maps the near corner to the first row and column", () => {
    expect(nearestCell(-1, -1, 5, 4)).toEqual({ row: 0, col: 0 });
  });

  it("maps the far corner to the last row and column", () => {
    expect(nearestCell(1, 1, 5, 4)).toEqual({ row: 4, col: 3 });
  });

  it("maps the centre to the middle", () => {
    expect(nearestCell(0, 0, 5, 5)).toEqual({ row: 2, col: 2 });
  });

  it("clamps input below the mesh", () => {
    expect(nearestCell(-4, -4, 3, 3)).toEqual({ row: 0, col: 0 });
  });

  it("clamps input above the mesh", () => {
    expect(nearestCell(4, 4, 3, 3)).toEqual({ row: 2, col: 2 });
  });

  it("collapses a single row or column onto index 0", () => {
    expect(nearestCell(0.5, 0, 1, 1)).toEqual({ row: 0, col: 0 });
  });
});

describe("nearestIndex", () => {
  it("picks the closest value", () => {
    expect(nearestIndex([465, 470, 475], 471.25)).toBe(1);
  });

  it("picks the lower value when two are equidistant", () => {
    expect(nearestIndex([465, 475], 470)).toBe(0);
  });

  it("returns -1 when there is nothing to pick from", () => {
    expect(nearestIndex([], 470)).toBe(-1);
  });
});