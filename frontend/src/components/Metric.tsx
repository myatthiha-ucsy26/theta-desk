/** The tone vocabulary every reading shares, so a tile and a card colour the same figure alike. */
export const TONE = {
  profit: "text-profit",
  loss: "text-loss",
  muted: "text-ink-2",
} as const;

/**
 * One reading under a label, the way a tile in a summary grid is set. The card around it comes
 * from the template; this is only the label-over-figure.
 */
export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm tabular-nums ${tone ? TONE[tone] : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}