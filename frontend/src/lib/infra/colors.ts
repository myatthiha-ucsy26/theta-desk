// Chart colours, one set per theme, drawn from the Broadsheet ink set.
//   Sequential (IV magnitude): one press-blue hue. Light runs pale -> deep so small values
//   sink into the paper; dark flips the anchor so small values sink into the night page.
//   Diverging (P&L): loss ink <-> neutral <-> gain pivot <-> profit ink, in the mockup's own
//   inks. The two poles are 18 L* apart as well as opposite in hue, so a red-green colour
//   blindness still separates them, and every value also carries a sign, so colour is never
//   the only cue.
//   Ordinal (gate funnel): monotone press-blue steps, light end >= 2:1 against the paper.
//   Accent: one saturated cyan for the 3D scene — the key light, the wire over the surface, the
//   marker node and its pole, the floor's centre lines. It sits outside the value ramps on
//   purpose: the surface fill is data, and the scene's chrome must never be read as one.
import type { Theme } from "./theme";

export interface ChartPalette {
  sequential: readonly string[];
  /** The two poles of the P&L ramp, and the neutral it runs through at zero. */
  profit: string;
  loss: string;
  mid: string;
  /**
   * The cyan the P&L ramp turns through on its way from neutral to profit, reached at half the
   * gain scale. Straight neutral -> profit spends the whole plateau on one blend; the mockup
   * splits it, and the corner is what makes the profit region read as reached rather than
   * approached. Kept separate from `accent` though the light values agree today: one is a
   * reading, the other is scenery, and they must be free to move apart.
   */
  gainPivot: string;
  ordinal: readonly string[];
  /** Wireframe and axis lines on the 3D canvas. */
  line: string;
  /**
   * The cyan the mockup draws its 3D scene in. Saturated rather than dark, so it separates from
   * both surfaces this app puts under it: the press-blue IV ramp it shares a hue family with,
   * and the red/green P&L diverge it does not.
   */
  accent: string;
}

export const PALETTES: Record<Theme, ChartPalette> = {
  light: {
    sequential: ["#eaf0f5", "#cbdae6", "#a8c3d6", "#82a8c4", "#5c8bb0", "#3d6e94", "#275378", "#1a3e5c", "#10293d"],
    profit: "#10b981",
    loss: "#e11d48",
    mid: "#cbd5e1",
    gainPivot: "#0284c7",
    ordinal: ["#5c8bb0", "#3d6e94", "#275378", "#1a3e5c", "#10293d"],
    line: "#191713",
    accent: "#0284c7",
  },
  dark: {
    sequential: ["#0f1c29", "#16304a", "#1e4568", "#2a5c86", "#3d78a5", "#5b97c3", "#82b4d8", "#aed1e9", "#d8e8f4"],
    profit: "#34d399",
    loss: "#f43f5e",
    mid: "#2a3340",
    gainPivot: "#38bdf8",
    ordinal: ["#2a5c86", "#3d78a5", "#5b97c3", "#82b4d8", "#aed1e9"],
    line: "#e8e3d9",
    // Lifted for the night page: the mockup's own cyan goes muddy against a dark ground.
    accent: "#38bdf8",
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => ra[i] + (rb[i] - ra[i]) * t) as [number, number, number]);
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** t in [0, 1] -> press-blue ramp colour (low -> high magnitude). */
export function sequentialColor(t: number, theme: Theme): string {
  const ramp = PALETTES[theme].sequential;
  const x = clamp01(t) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  if (x <= 0) return ramp[0];
  if (x >= ramp.length - 1) return ramp[ramp.length - 1];
  return mix(ramp[i], ramp[i + 1], x - i);
}

/** value in [-maxAbs, maxAbs] -> loss ink / neutral / gain pivot / profit ink. */
export function divergingColor(value: number, maxAbs: number, theme: Theme): string {
  const { profit, loss, mid, gainPivot } = PALETTES[theme];
  if (!maxAbs || value === 0) return mid;
  const t = clamp01(Math.abs(value) / maxAbs);
  if (value < 0) return t === 1 ? loss : mix(mid, loss, t);
  if (t === 1) return profit;
  // The gain side turns at the pivot halfway up, as the mockup's surface does.
  return t <= 0.5 ? mix(mid, gainPivot, t * 2) : mix(gainPivot, profit, (t - 0.5) * 2);
}