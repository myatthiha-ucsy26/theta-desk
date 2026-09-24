// The holo band over Scan and Manage: the orb on its grid floor, and the book's headline figures
// as glass readouts beside it. The same figures, from the same calls, as the other templates'
// ledger band — only the setting is different.
import { lazy, Suspense } from "react";
import { api } from "../../lib/api";
import { accountCards, statCards, type StatCard } from "../../lib/header";
import { usePrefersReducedMotion } from "../../lib/motion";
import { orbParams } from "../../lib/orb";
import { usePoll } from "../../lib/usePoll";
import { OrbFallback } from "./OrbFallback";
import { useDeskWidth } from "./useMedia";

const HoloOrb = lazy(() => import("./HoloOrb"));

const BOOK_POLL_MS = 60000;

/** Whether this browser can give the orb a GL context at all. */
function hasWebGL(): boolean {
  if (typeof WebGLRenderingContext === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

const TONE_CLASS = { profit: "text-profit", loss: "text-loss" } as const;

export function HoloBand() {
  const book = usePoll(() => api.paper(), BOOK_POLL_MS);
  const settings = usePoll(() => api.settings(), BOOK_POLL_MS);
  const account = usePoll(() => api.account(), BOOK_POLL_MS);
  const desk = useDeskWidth();
  const still = usePrefersReducedMotion();
  const maxOpen = settings.data?.max_open_positions ?? null;
  const params = orbParams(book.data?.stats ?? null, account.data, maxOpen);
  const gl = desk && hasWebGL();

  return (
    <section aria-label="Book at a glance" className="holo-band grid gap-4 py-5 min-[900px]:grid-cols-[minmax(240px,340px)_1fr] min-[900px]:items-center min-[900px]:gap-8">
      <div aria-hidden="true" className={`holo-orb-slot holo-tone-${params.tone} h-[180px] min-[900px]:h-[260px]`}>
        {gl ? (
          <Suspense fallback={<OrbFallback params={params} />}>
            <HoloOrb params={params} still={still} />
          </Suspense>
        ) : (
          <OrbFallback params={params} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Readouts title="Paper book" cards={statCards(book.data, maxOpen)} large />
        <Readouts
          title="Real account · moomoo"
          cards={accountCards(account.data)}
          error={account.data ? null : account.error}
        />
      </div>
    </section>
  );
}

function Readouts({ title, cards, error, large = false }: {
  title: string;
  cards: StatCard[];
  error?: string | null;
  large?: boolean;
}) {
  return (
    <section role="group" aria-label={title} className="flex flex-col gap-2">
      <h2 className="eyebrow flex items-baseline gap-2">
        {title}
        {error && <span className="normal-case tracking-normal text-loss">{error}</span>}
      </h2>
      <dl className={`grid gap-3 ${large ? "grid-cols-2 min-[1200px]:grid-cols-4" : "grid-cols-2"}`}>
        {cards.map((c) => (
          <div key={c.label} className="holo-readout flex h-full flex-col px-4 py-3">
            <dt className="eyebrow">{c.label}</dt>
            <dd className="mt-1 flex flex-1 flex-col">
              <span className={`figure leading-none ${large ? "text-[26px]" : "text-[18px]"} ${c.tone ? TONE_CLASS[c.tone] : "text-ink"}`}>
                {c.value}
              </span>
              {c.note && <span className="mt-1.5 text-[11px] text-ink-2">{c.note}</span>}
              {c.meter !== undefined && (
                <span aria-hidden="true" className="mt-auto block pt-3">
                  <span className="meter-track block h-[3px] overflow-hidden rounded-full bg-well">
                    <span
                      className={`meter-bar block h-full rounded-full ${c.over ? "bg-critical" : "holo-meter"}`}
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
