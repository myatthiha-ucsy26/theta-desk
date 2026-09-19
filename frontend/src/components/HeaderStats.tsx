import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import { accountCards, latestSpots, marqueeSeconds, shouldScroll, statCards, type StatCard } from "../lib/header";
import { usePrefersReducedMotion } from "../lib/motion";
import { formatTime } from "../lib/time";
import { usePoll } from "../lib/usePoll";

const SCAN_POLL_MS = 30000;
const BOOK_POLL_MS = 60000;

/**
 * The market tape. Each watchlist ticker at the spot the last scan saw, labelled as such:
 * these are not live quotes. When the prices don't fit on one line they slide (no scrollbar);
 * with reduced motion they wrap instead, so every ticker is always visible.
 */
export function TickerStrip() {
  const scan = usePoll(() => api.scanLatest(), SCAN_POLL_MS);
  const spots = latestSpots(scan.data ?? []);
  const reducedMotion = usePrefersReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const list = listRef.current;
    if (!viewport || !list) return;
    const measure = () => setOverflowing(shouldScroll(list.scrollWidth, viewport.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(list);
    return () => observer.disconnect();
  }, [spots.length, reducedMotion]);

  if (spots.length === 0) return null;
  const newest = spots.reduce((m, s) => (s.ts > m ? s.ts : m), spots[0].ts);
  const scrolling = overflowing && !reducedMotion;

  const quotes = spots.map((s, i) => (
    <li
      key={s.ticker}
      className={`flex shrink-0 items-baseline gap-2 py-1.5 pr-4 ${i > 0 ? "border-l border-rule pl-4" : ""}`}
    >
      <span className="eyebrow text-ink">{s.ticker}</span>
      <span className="text-xs text-ink-2">{s.spot.toFixed(2)}</span>
    </li>
  ));

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-rule py-1">
      <span className="eyebrow flex shrink-0 items-center gap-1.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-good" />
        Spot at last scan · {formatTime(newest)}
      </span>
      {reducedMotion ? (
        <ul className="flex min-w-0 flex-1 flex-wrap items-center">{quotes}</ul>
      ) : (
        <div ref={viewportRef} className={`min-w-0 flex-1 ${scrolling ? "tape-viewport" : "overflow-hidden"}`}>
          <div
            className={scrolling ? "tape-track" : "flex"}
            style={scrolling ? ({ "--marquee-duration": `${marqueeSeconds(spots.length)}s` } as CSSProperties) : undefined}
          >
            <ul ref={listRef} className="flex shrink-0 items-center">
              {quotes}
            </ul>
            {scrolling && (
              <ul aria-hidden="true" className="flex shrink-0 items-center">
                {quotes}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The ledger band: headline figures from the paper book and the real moomoo account, set
 * across the page like a printed statistics row — a rule above, a rule between each column.
 */
export function StatCards() {
  const book = usePoll(() => api.paper(), BOOK_POLL_MS);
  const settings = usePoll(() => api.settings(), BOOK_POLL_MS);
  const account = usePoll(() => api.account(), BOOK_POLL_MS);

  return (
    <div className="flex flex-col gap-6">
      <LedgerBand title="Paper book" cards={statCards(book.data, settings.data?.max_open_positions ?? null)} />
      <LedgerBand
        title="Real account · moomoo"
        cards={accountCards(account.data)}
        error={account.data ? null : account.error}
      />
    </div>
  );
}

function LedgerBand({ title, cards, error }: { title: string; cards: StatCard[]; error?: string | null }) {
  return (
    <section role="group" aria-label={title} className="ledger-band flex flex-col">
      <h2 className="eyebrow flex items-baseline gap-2 border-b border-ink pb-1.5">
        {title}
        {error && <span className="normal-case tracking-normal text-loss">{error}</span>}
      </h2>
      <dl className="flex divide-x divide-rule overflow-x-auto">
        {cards.map((c) => (
          <div key={c.label} className="ledger-card flex min-w-[9rem] flex-1 flex-col px-4 pt-3 first:pl-0 last:pr-0">
            <dt className="eyebrow">{c.label}</dt>
            <dd className="mt-1 flex flex-1 flex-col">
              <span
                className={`figure text-[28px] leading-none min-[900px]:text-[32px] ${
                  c.tone === "profit" ? "text-profit" : c.tone === "loss" ? "text-loss" : "text-ink"
                }`}
              >
                {c.value}
              </span>
              <span className="mt-1.5 text-[11px] text-ink-2">{c.note}</span>
              {c.meter !== undefined && (
                <span aria-hidden="true" className="mt-auto block pt-3">
                  <span className="meter-track block h-[2px] bg-rule">
                    <span
                      className={`meter-bar block h-full ${c.over ? "bg-critical" : "bg-accent"}`}
                      style={{ width: `${c.meter}%` }}
                    />
                  </span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}