// The shared control vocabulary. Square corners throughout: the page is a printed sheet,
// and hierarchy comes from rules and type rather than from panels and pills.
export const BTN =
  "inline-flex items-center gap-1.5 border border-rule-strong px-3 py-1.5 text-sm text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_SOLID =
  "inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 text-sm text-sheet transition-colors hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_DANGER =
  "inline-flex items-center gap-1.5 border border-critical px-3 py-1.5 text-sm text-critical transition-colors hover:bg-critical/10 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_QUIET =
  "inline-flex items-center gap-1.5 px-1 py-0.5 text-xs text-ink-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

export const INPUT =
  "border border-rule-strong bg-well px-2 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-2 focus:border-accent focus:outline-none disabled:opacity-50";

/** A field's label, set like a printed table column head. */
export const LABEL = "eyebrow block";