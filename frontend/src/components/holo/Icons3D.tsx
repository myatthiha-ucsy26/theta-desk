// Holo's glyphs: solid isometric objects with a lit top, a mid left face and a shaded right face,
// rather than the line icons the other templates draw. Plain SVG, so they stay sharp at any size
// and cost nothing on a phone. Same meanings as the line set they stand in for.
import type { ReactNode } from "react";

/** Top, left, right: one light source from the upper left, so every object reads as the same scene. */
type Faces = readonly [string, string, string];

const CYAN: Faces = ["#a5f3fc", "#0891b2", "#0e7490"];
const INDIGO: Faces = ["#c7d2fe", "#6366f1", "#4338ca"];
const VIOLET: Faces = ["#e9d5ff", "#a855f7", "#7e22ce"];
const GREEN: Faces = ["#a7f3d0", "#059669", "#047857"];
const SLATE: Faces = ["#cbd5e1", "#475569", "#334155"];

const COS = 0.866;

/**
 * An isometric box standing on the ground point (cx, cy): a square base s wide along each iso
 * axis, h tall. The ground point is the base's centre, so boxes line up by where they stand.
 */
function Box({ cx, cy, s, h, faces }: { cx: number; cy: number; s: number; h: number; faces: Faces }) {
  const n = [cx, cy - s / 2];
  const e = [cx + s * COS, cy];
  const so = [cx, cy + s / 2];
  const w = [cx - s * COS, cy];
  const up = (p: number[]) => [p[0], p[1] - h];
  const pts = (...ps: number[][]) => ps.map((p) => p.join(",")).join(" ");
  return (
    <g>
      <polygon points={pts(w, so, up(so), up(w))} fill={faces[1]} />
      <polygon points={pts(so, e, up(e), up(so))} fill={faces[2]} />
      <polygon points={pts(up(n), up(e), up(so), up(w))} fill={faces[0]} />
    </g>
  );
}

/** A disc lying flat: a lit top ellipse over a band of its own edge. */
function Disc({ cx, cy, rx, ry, h, top, edge }: {
  cx: number; cy: number; rx: number; ry: number; h: number; top: string; edge: string;
}) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={edge} />
      <rect x={cx - rx} y={cy - h} width={rx * 2} height={h} fill={edge} />
      <ellipse cx={cx} cy={cy - h} rx={rx} ry={ry} fill={top} />
    </g>
  );
}

const GLYPHS = {
  // Radar: a lit dish with its sweep.
  scan: (
    <>
      <Disc cx={32} cy={42} rx={24} ry={12} h={6} top="#22d3ee" edge="#1e40af" />
      <ellipse cx={32} cy={36} rx={15} ry={7.5} fill="none" stroke="#e0f2fe" strokeOpacity={0.7} />
      <ellipse cx={32} cy={36} rx={5} ry={2.5} fill="#e0f2fe" />
      <path d="M32 36 L50 28 A24 12 0 0 1 56 36 Z" fill="#fff" fillOpacity={0.35} />
      <path d="M32 36 L50 28" stroke="#fff" strokeWidth={2} />
    </>
  ),
  // Two candles on a plinth: one ticker, looked at closely.
  study: (
    <>
      <Box cx={32} cy={50} s={22} h={4} faces={SLATE} />
      <path d="M24 16 V44" stroke="#34d399" strokeWidth={1.5} />
      <Box cx={24} cy={40} s={6} h={18} faces={GREEN} />
      <path d="M40 10 V40" stroke="#fb7185" strokeWidth={1.5} />
      <Box cx={40} cy={34} s={6} h={14} faces={["#fecdd3", "#e11d48", "#9f1239"]} />
    </>
  ),
  // A stack of coins: the book.
  manage: (
    <>
      <Disc cx={32} cy={52} rx={20} ry={7} h={7} top="#fbbf24" edge="#92400e" />
      <Disc cx={32} cy={42} rx={20} ry={7} h={7} top="#fbbf24" edge="#b45309" />
      <Disc cx={34} cy={32} rx={20} ry={7} h={7} top="#fde68a" edge="#b45309" />
      <ellipse cx={34} cy={25} rx={11} ry={3.8} fill="none" stroke="#b45309" strokeWidth={1.5} />
    </>
  ),
  // A funnel: what passed each gate.
  learn: (
    <>
      <path d="M10 18 L28 44 V56 L36 58 V44 L54 18 Z" fill="#6366f1" />
      <path d="M32 20 L54 18 L36 44 V58 L32 56 Z" fill="#4338ca" />
      <ellipse cx={32} cy={18} rx={22} ry={8} fill="#c7d2fe" />
      <ellipse cx={32} cy={18} rx={15} ry={5} fill="#312e81" />
      <circle cx={32} cy={17} r={2.5} fill="#34d399" />
    </>
  ),
  // A control deck with two sliders set.
  settings: (
    <>
      <Box cx={32} cy={46} s={24} h={8} faces={SLATE} />
      <path d="M17 29 L35 39 M29 22 L47 32" stroke="#0f172a" strokeWidth={2.5} strokeLinecap="round" />
      <Box cx={24} cy={35} s={5} h={6} faces={CYAN} />
      <Box cx={42} cy={30} s={5} h={6} faces={VIOLET} />
    </>
  ),
  // The bot: a cube head with an antenna and two lit eyes.
  bot: (
    <>
      <Box cx={32} cy={52} s={20} h={26} faces={INDIGO} />
      <path d="M32 16 V8" stroke="#a5b4fc" strokeWidth={2} />
      <circle cx={32} cy={7} r={3} fill="#22d3ee" />
      <circle cx={21} cy={40} r={2.6} fill="#67e8f9" />
      <circle cx={27} cy={43} r={2.6} fill="#67e8f9" />
    </>
  ),
  // Signal: a wave standing on a tile.
  signal: (
    <>
      <Box cx={32} cy={46} s={24} h={4} faces={SLATE} />
      <path d="M12 34 C18 22 24 22 30 32 S42 42 52 26" stroke="#22d3ee" strokeWidth={3.5} fill="none" strokeLinecap="round" />
      <path d="M12 26 C18 14 24 14 30 24 S42 34 52 18" stroke="#a855f7" strokeWidth={2} fill="none" strokeLinecap="round" strokeOpacity={0.8} />
    </>
  ),
  // Spread fits: a short leg slab set into a longer one.
  spread: (
    <>
      <Box cx={32} cy={50} s={22} h={8} faces={INDIGO} />
      <Box cx={32} cy={38} s={14} h={10} faces={CYAN} />
    </>
  ),
  // Backtest edge: bars rising, with the trend drawn over them.
  backtest: (
    <>
      <Box cx={16} cy={52} s={8} h={10} faces={GREEN} />
      <Box cx={30} cy={52} s={8} h={20} faces={CYAN} />
      <Box cx={44} cy={52} s={8} h={32} faces={INDIGO} />
      <path d="M12 36 L28 26 L42 12 L54 8" stroke="#34d399" strokeWidth={2} fill="none" />
      <circle cx={54} cy={8} r={2.5} fill="#34d399" />
    </>
  ),
  // Risk limits: a shield, lit on its left face, with the check.
  risk: (
    <>
      <path d="M34 8 l20 7 v15 c0 13 -9 21 -20 25 z" fill="#312e81" />
      <path d="M30 6 l20 7 v15 c0 13 -9 21 -20 25 c-11 -4 -20 -12 -20 -25 v-15z" fill="#8b5cf6" />
      <path d="M30 6 l20 7 v15 c0 13 -9 21 -20 25z" fill="#000" fillOpacity={0.2} />
      <path d="M21 30 l6 6 l12 -13" stroke="#ecfeff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // AI review: a chip on its pins, with a lit core.
  ai: (
    <>
      <path d="M14 42 v6 M20 45 v6 M26 48 v6 M38 48 v6 M44 45 v6 M50 42 v6" stroke="#64748b" strokeWidth={2} />
      <Box cx={32} cy={44} s={22} h={7} faces={VIOLET} />
      <Box cx={32} cy={37} s={10} h={3} faces={CYAN} />
    </>
  ),
  // Not a repeat: one block standing, its double struck through.
  repeat: (
    <>
      <Box cx={42} cy={44} s={12} h={14} faces={SLATE} />
      <Box cx={24} cy={52} s={12} h={20} faces={CYAN} />
      <path d="M32 14 L54 40" stroke="#fb7185" strokeWidth={3.5} strokeLinecap="round" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type Icon3DName = keyof typeof GLYPHS;

export function Icon3D({ name, size = 20 }: { name: Icon3DName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="icon-3d shrink-0">
      {GLYPHS[name]}
    </svg>
  );
}

/** Which 3D glyph stands in for each gate, keyed by the gate's own name as the line set is. */
export const GATE_3D: Record<string, Icon3DName> = {
  Signal: "signal",
  "Spread fits": "spread",
  "Backtest edge": "backtest",
  "Risk limits": "risk",
  "AI review": "ai",
  "Not a repeat": "repeat",
};
