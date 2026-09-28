import { describe, expect, it } from "vitest";
import { PALETTES, divergingColor, sequentialColor } from "./colors";

const LIGHT = PALETTES.light;
const DARK = PALETTES.dark;

describe("sequentialColor", () => {
  it("maps 0 to the first step and 1 to the last", () => {
    expect(sequentialColor(0, "light")).toBe(LIGHT.sequential[0]);
    expect(sequentialColor(1, "light")).toBe(LIGHT.sequential[LIGHT.sequential.length - 1]);
  });

  it("clamps out-of-range input", () => {
    expect(sequentialColor(-2, "light")).toBe(LIGHT.sequential[0]);
    expect(sequentialColor(9, "light")).toBe(LIGHT.sequential[LIGHT.sequential.length - 1]);
  });

  it("lands exactly on a step at step positions", () => {
    expect(sequentialColor(0.5, "light")).toBe(LIGHT.sequential[4]); // 9 steps: 0.5 is step 4
  });

  it("interpolates between steps", () => {
    const between = sequentialColor(0.5 / 8, "light"); // halfway from step 0 to step 1
    expect(between).toMatch(/^#[0-9a-f]{6}$/);
    expect(between).not.toBe(LIGHT.sequential[0]);
    expect(between).not.toBe(LIGHT.sequential[1]);
  });

  it("uses the dark ramp in dark mode", () => {
    expect(sequentialColor(0, "dark")).toBe(DARK.sequential[0]);
    expect(sequentialColor(1, "dark")).toBe(DARK.sequential[DARK.sequential.length - 1]);
  });
});

describe("divergingColor", () => {
  it("is the neutral midpoint at zero", () => {
    expect(divergingColor(0, 100, "light")).toBe(LIGHT.mid);
    expect(divergingColor(0, 100, "dark")).toBe(DARK.mid);
  });

  it("uses the profit pole for the maximum gain and the loss pole for the maximum loss", () => {
    expect(divergingColor(100, 100, "light")).toBe(LIGHT.profit);
    expect(divergingColor(-100, 100, "light")).toBe(LIGHT.loss);
    expect(divergingColor(-100, 100, "dark")).toBe(DARK.loss);
  });

  it("clamps beyond the scale and survives a zero scale", () => {
    expect(divergingColor(500, 100, "light")).toBe(LIGHT.profit);
    expect(divergingColor(5, 0, "light")).toBe(LIGHT.mid);
  });
});
