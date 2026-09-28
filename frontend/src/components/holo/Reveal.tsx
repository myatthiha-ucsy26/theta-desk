// How Holo brings a panel onto the page. Nothing here leans or tilts: under the pointer a card
// only rises a little on a deeper shadow, and that is CSS (styles.css).
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Comes up out of the blur as it scrolls into view — the depth-of-field step between sections.
 * The blur is dropped once it lands: a standing `filter` would hold a compositing layer open
 * for every panel on the page, and would pin any fixed-position child to the panel.
 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24, scale: 0.98, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Every panel in Holo: revealed on scroll. */
export function HoloPanelFrame({ children }: { children: ReactNode }) {
  return <Reveal className="min-w-0">{children}</Reveal>;
}
