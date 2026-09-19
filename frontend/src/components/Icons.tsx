// Line icons for the section bar and masthead. 16px, stroke follows the text colour.
// Drawn light (1.5) so they sit quietly beside the Newsreader headings.
import type { ReactNode } from "react";
import type { Screen } from "../lib/route";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/**
 * The nameplate device: theta — the letter the desk is named for, and the thing it actually
 * sells. A tall ring with the bar through it, on the same 24-grid and the same 2px stroke as
 * the screen icons so it sits with them rather than beside them. Drawn tall rather than round
 * on purpose: a circle with a bar is a prohibition sign, an ellipse with a bar is a letter.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className="shrink-0"
    >
      <ellipse cx="12" cy="12" rx="6.6" ry="9" />
      {/* The bar is the short strike: flat, and held. What it earns is the whole trade. */}
      <path d="M5.4 12h13.2" />
    </svg>
  );
}

export const SCREEN_ICONS: Record<Screen, ReactNode> = {
  // Radar: the engine sweeping the watchlist.
  scan: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 L18 6" />
    </Icon>
  ),
  // A chart with a probe: one ticker, looked at closely.
  study: (
    <Icon>
      <path d="M3 20h18" />
      <path d="M5 16l4-5 4 3 6-8" />
      <circle cx="19" cy="6" r="1.5" />
    </Icon>
  ),
  // A ledger: the paper book.
  manage: (
    <Icon>
      <path d="M3 10h18" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
      <path d="M3 21h18" />
      <path d="M12 3l9 5H3z" />
    </Icon>
  ),
  // A funnel: what passed each gate.
  learn: (
    <Icon>
      <path d="M3 4h18l-7 8v6l-4 2v-8z" />
    </Icon>
  ),
  settings: (
    <Icon>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Icon>
  ),
};

/** The bot itself: a controller with an antenna, for the panel that reports what it is doing. */
export function BotIcon() {
  return (
    <Icon>
      <rect x="4" y="8" width="16" height="11" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.4" r="1.2" />
      <circle cx="9.5" cy="13" r="1" />
      <circle cx="14.5" cy="13" r="1" />
      <path d="M1.5 12.5v3M22.5 12.5v3" />
    </Icon>
  );
}

/** One glyph per gate in the pipeline strip, keyed by the gate's own name. */
export const GATE_ICONS: Record<string, ReactNode> = {
  // Waves: the regime the signal reads.
  Signal: (
    <Icon size={15}>
      <path d="M2 9c2.5-3 5-3 7.5 0S19.5 12 22 9" />
      <path d="M2 15c2.5-3 5-3 7.5 0s5 3 7.5 0" />
    </Icon>
  ),
  // Two rungs and the width between them: the spread itself.
  "Spread fits": (
    <Icon size={15}>
      <path d="M4 8h16M4 16h16" />
      <path d="M9 8v8M17 8v8" />
    </Icon>
  ),
  // A rising series: measured expectancy, not a promise.
  "Backtest edge": (
    <Icon size={15}>
      <path d="M3 20h18" />
      <path d="M5 17V11M10 17V7M15 17v-4M20 17V5" />
    </Icon>
  ),
  // A shield: what the caps are for.
  "Risk limits": (
    <Icon size={15}>
      <path d="M12 3l7 3v6c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  ),
  // A chip: the model's read.
  "AI review": (
    <Icon size={15}>
      <rect x="7" y="7" width="10" height="10" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </Icon>
  ),
  // A clock: the cooldown since the last alert.
  "Not a repeat": (
    <Icon size={15}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </Icon>
  ),
};

export function MoonIcon() {
  return (
    <Icon size={14}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />
    </Icon>
  );
}

export function SunIcon() {
  return (
    <Icon size={14}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </Icon>
  );
}