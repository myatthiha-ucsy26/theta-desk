import { dismissToast, useToasts } from "../lib/toast";
import { Glyph } from "./StatusBadge";

const EDGE = { good: "border-l-good", critical: "border-l-critical" } as const;

/** Stacks slips in the top-right corner, read out politely by screen readers. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex animate-toast items-start gap-2 border border-l-2 border-rule bg-sheet px-3 py-2.5 text-sm text-ink shadow-[var(--shadow-lift)] ${EDGE[t.tone]}`}
        >
          <span className="mt-0.5">
            <Glyph tone={t.tone} />
          </span>
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="-mr-1 px-1 text-ink-2 hover:text-ink"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
