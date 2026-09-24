// Template 3 · Holo: a glass nav over deep navy, the tape, the holo band on the book's screens,
// then the screen itself with every panel set as a floating glass card.
import { motion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { PanelFrame } from "../../lib/panelFrame";
import { hrefFor, SCREENS, type Screen } from "../../lib/route";
import { dateline } from "../../lib/time";
import { TickerStrip } from "../HeaderStats";
import { Mark, SCREEN_ICONS } from "../Icons";
import { LABELS, showsStats } from "../Shell";
import { StatusBar } from "../StatusBar";
import { Toaster } from "../Toaster";
import { HoloBand } from "./HoloBand";
import { HoloPanelFrame } from "./Reveal";

export default function HoloShell({ screen, children }: { screen: Screen; children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <PanelFrame.Provider value={HoloPanelFrame}>
        <div className="holo-page flex min-h-full flex-col">
          <HoloNav screen={screen} />
          <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 min-[900px]:px-8">
            <StatusBar />
            <TickerStrip />
            {showsStats(screen) && <HoloBand />}
            <main className="flex min-w-0 flex-1 flex-col py-6 min-[900px]:py-8">
              {/* Opacity only: a transform here would pin the size drawer to this box instead of
                  the window. */}
              <motion.div
                key={screen}
                className="min-w-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            </main>
          </div>
          <Toaster />
        </div>
      </PanelFrame.Provider>
    </MotionConfig>
  );
}

/** One bar across the top, frosted over whatever scrolls under it. No theme switch: Holo is dark only. */
function HoloNav({ screen }: { screen: Screen }) {
  return (
    <header className="holo-nav sticky top-0 z-30">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-2.5 min-[900px]:gap-8 min-[900px]:px-8">
        <h1 className="shrink-0">
          <a href={hrefFor("scan")} className="flex items-center gap-2.5 transition-opacity hover:opacity-85">
            <span className="holo-mark text-accent">
              <Mark />
            </span>
            <span className="holo-extrude font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">
              Theta Desk
            </span>
          </a>
        </h1>
        <nav aria-label="Screens" className="min-w-0 flex-1">
          <ul className="flex items-center gap-1 overflow-x-auto">
            {SCREENS.map((s) => (
              <li key={s} className="flex shrink-0">
                <a
                  href={hrefFor(s)}
                  aria-current={s === screen ? "page" : undefined}
                  className="holo-link flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium"
                >
                  <span aria-hidden="true" className="holo-link-icon">{SCREEN_ICONS[s]}</span>
                  {LABELS[s]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <span className="eyebrow hidden shrink-0 min-[1100px]:inline">{dateline()}</span>
      </div>
    </header>
  );
}
