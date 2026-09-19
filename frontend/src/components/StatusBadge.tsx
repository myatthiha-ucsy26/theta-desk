// A status stamp: colour is never the only signal, so every tone carries an icon.
export type Tone = "good" | "warn" | "critical" | "neutral";

const ICON_COLOR: Record<Tone, string> = {
  good: "text-good",
  warn: "text-warn",
  critical: "text-critical",
  neutral: "text-ink-2",
};

export function Glyph({ tone }: { tone: Tone }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`shrink-0 ${ICON_COLOR[tone]}`}
    >
      {tone === "good" && (
        <path d="M2 7.5 L5.5 11 L12 3" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
      )}
      {tone === "warn" && (
        <>
          <path d="M7 2 L13 12 H1 Z" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinejoin="round" />
          <path d="M7 6 V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {tone === "critical" && (
        <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" />
      )}
      {tone === "neutral" && <circle cx="7" cy="7" r="3" fill="currentColor" />}
    </svg>
  );
}

const CHIP: Record<Tone, string> = {
  good: "border-good/45",
  warn: "border-warn/45",
  critical: "border-critical/45",
  neutral: "border-rule",
};

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[11px] leading-4 text-ink ${CHIP[tone]}`}>
      <Glyph tone={tone} />
      {label}
    </span>
  );
}