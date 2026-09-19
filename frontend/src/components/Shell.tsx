import type { ReactNode } from "react";
import { hrefFor, SCREENS, type Screen } from "../lib/route";
import { useTemplate } from "../lib/templates";
import { setTheme, useTheme } from "../lib/theme";
import { dateline } from "../lib/time";
import { StatCards, TickerStrip } from "./HeaderStats";
import { Mark, MoonIcon, SCREEN_ICONS, SunIcon } from "./Icons";
import { StatusBar } from "./StatusBar";
import { Toaster } from "./Toaster";

const LABELS: Record<Screen, string> = {
  scan: "Scan",
  study: "Study",
  manage: "Manage",
  learn: "Learn",
  settings: "Settings",
};

/** What each section is for, under its name in the rail. */
const DESCRIPTIONS: Record<Screen, string> = {
  scan: "Gates and decisions",
  study: "Signals and payoff",
  manage: "Open spreads and risk",
  learn: "Edge and drop-off",
  settings: "Risk cap and rules",
};

/**
 * The desk's own figures, on the two screens that are about the book: Scan and Manage.
 *
 * Learn is about the funnel and the edge, Study about a single setup, and Settings edits the risk cap
 * and the rules. Set above any of those, the paper and real books are two screens' worth of numbers
 * that only push the work down the page.
 */
const showsStats = (screen: Screen) => screen === "scan" || screen === "manage";

/**
 * The page. Which arrangement you get is the template's business: Broadsheet leads with a
 * nameplate and a section bar across the top, Minimal sets the same parts in a rail down the
 * left and lets the work surface run from the rail outwards. Both render the same four things in
 * the same order — who the desk is, where you are, what the market did, what the book is worth.
 */
export function Shell({ screen, children }: { screen: Screen; children: ReactNode }) {
  const template = useTemplate();
  return template === "minimal" ? (
    <RailShell screen={screen}>{children}</RailShell>
  ) : (
    <ColumnShell screen={screen}>{children}</ColumnShell>
  );
}

/** Template 1 · Broadsheet: a nameplate, a section bar, the folio line, the tape, then the column. */
function ColumnShell({ screen, children }: { screen: Screen; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 min-[900px]:px-8">
        <Masthead />
        <SectionBar screen={screen} />
        <StatusBar />
        <TickerStrip />
        <main className="flex min-w-0 flex-1 flex-col gap-7 py-6 min-[900px]:gap-9 min-[900px]:py-8">
          {showsStats(screen) && <StatCards />}
          <div className="min-w-0">{children}</div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

/** Template 2 · Minimal: the same parts in a rail, and a work surface that starts at the rail. */
function RailShell({ screen, children }: { screen: Screen; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col min-[900px]:flex-row">
      <Rail screen={screen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex w-full max-w-[1400px] flex-1 flex-col px-4 min-[900px]:px-10">
          <StatusBar />
          <TickerStrip />
          <main className="flex min-w-0 flex-1 flex-col gap-7 py-6 min-[900px]:gap-8 min-[900px]:py-9">
            {showsStats(screen) && <StatCards />}
            <div className="min-w-0">{children}</div>
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/**
 * The rail: brand, sections, edition switch. One element that is a top bar on a phone and a
 * column on a desk — the direction flips at 900px rather than the markup, so the desk is named
 * exactly once in the document either way. On a desk each section carries what it is for as
 * well as its name; on a phone only the name fits, so the descriptor is dropped.
 */
function Rail({ screen }: { screen: Screen }) {
  return (
    <aside className="rail flex shrink-0 flex-row items-center gap-3 border-b border-rule bg-sheet px-4 py-2.5 min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen min-[900px]:w-52 min-[900px]:flex-col min-[900px]:items-stretch min-[900px]:gap-5 min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:px-4 min-[900px]:py-7">
      <h1 className="rail-head flex shrink-0 items-center gap-2.5 min-[900px]:px-2.5">
        {/* The nameplate is the way back to the front page, the way it is on a masthead. */}
        <a
          href={hrefFor("scan")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-85"
        >
          <span className="text-ink">
            <Mark />
          </span>
          <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Theta Desk
          </span>
        </a>
      </h1>

      <nav aria-label="Screens" className="min-w-0 flex-1 min-[900px]:flex-none">
        <p className="rail-group hidden px-2.5 pb-1.5 min-[900px]:block">System pipeline</p>
        <ul className="flex items-stretch gap-1 overflow-x-auto min-[900px]:flex-col min-[900px]:gap-0 min-[900px]:overflow-visible">
          {SCREENS.map((s) => {
            const active = s === screen;
            return (
              <li key={s} className="flex shrink-0">
                <a
                  href={hrefFor(s)}
                  aria-current={active ? "page" : undefined}
                  // The descriptor sits in a flex column beside the name, so no whitespace joins
                  // them in the accessible name — it would read "ScanGates and decisions".
                  aria-label={`${LABELS[s]}, ${DESCRIPTIONS[s]}`}
                  className={`rail-link flex w-full items-center gap-2.5 px-2.5 py-2 text-sm transition-colors min-[900px]:flex-col min-[900px]:items-start min-[900px]:gap-1 min-[900px]:py-1.5 ${
                    active ? "font-semibold" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  <span className="flex w-full items-center gap-2.5">
                    {/* Each section carries its own glyph: at a glance down the rail the shape of
                        the radar or the flask says which one you are on faster than a numeral does.
                        The name sits right beside it, so the glyph is decoration and stays out of
                        the accessible name. */}
                    <span aria-hidden="true" className="rail-icon">
                      {SCREEN_ICONS[s]}
                    </span>
                    <span className="font-display text-[13px] font-semibold tracking-[-0.01em]">
                      {LABELS[s]}
                    </span>
                    {active && <span aria-hidden="true" className="rail-dot ml-auto" />}
                  </span>
                  <span className="rail-sub hidden min-[900px]:block">{DESCRIPTIONS[s]}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="rail-foot flex shrink-0 items-center gap-4 min-[900px]:mt-auto min-[900px]:flex-col min-[900px]:items-start min-[900px]:px-2.5">
        <span className="eyebrow hidden min-[900px]:inline">{dateline()}</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function Masthead() {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pb-3 pt-5 min-[900px]:pt-7">
      <h1 className="flex items-center gap-2.5">
        {/* The nameplate is the way back to the front page, the way it is in the rail. */}
        <a
          href={hrefFor("scan")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-85"
        >
          <span className="text-ink">
            <Mark />
          </span>
          <span className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink min-[900px]:text-[23px]">
            Theta Desk
          </span>
        </a>
      </h1>
      <div className="flex items-center gap-4">
        <span className="eyebrow hidden min-[640px]:inline">{dateline()}</span>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Section names as a newspaper section bar: the active one is underscored, nothing else moves. */
function SectionBar({ screen }: { screen: Screen }) {
  return (
    <nav aria-label="Screens" className="rule-nameplate border-b border-rule">
      <ul className="-mb-px flex items-stretch gap-1 overflow-x-auto min-[900px]:gap-2">
        {SCREENS.map((s) => {
          const active = s === screen;
          return (
            <li
              key={s}
              className={`flex shrink-0 border-b-2 ${
                active ? "border-ink" : "border-transparent hover:border-rule-strong"
              }`}
            >
              <a
                href={hrefFor(s)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 px-2.5 py-2.5 font-display text-[15px] transition-colors min-[900px]:px-3 min-[900px]:text-base ${
                  active ? "font-semibold text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {SCREEN_ICONS[s]}
                {LABELS[s]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A press-room toggle: the label names the edition you would switch to. */
function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="switch flex shrink-0 items-center gap-1.5 border border-rule px-2 py-1 text-ink-2 transition-colors hover:border-rule-strong hover:text-ink"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
      <span className="eyebrow text-current">{dark ? "Day edition" : "Night edition"}</span>
    </button>
  );
}