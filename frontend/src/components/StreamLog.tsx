import { useEffect, useRef } from "react";
import type { StreamLog as LogLine } from "../lib/api";

const NEAR_BOTTOM_PX = 16;

/** A run's log, monospaced so the numbers line up. It follows the tail unless you scroll up. */
export function StreamLog({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      }}
      className="log max-h-56 overflow-y-auto border border-rule bg-well p-2 leading-relaxed"
    >
      {lines.length === 0 ? (
        <p className="text-ink-2">Nothing yet.</p>
      ) : (
        lines.map((line, i) => (
          <p key={i} className="flex gap-2">
            <span className="w-16 shrink-0 text-ink-2">{line.step}</span>
            <span className="text-ink">{line.msg}</span>
          </p>
        ))
      )}
    </div>
  );
}