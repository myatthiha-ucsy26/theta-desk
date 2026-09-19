import { useEffect, useState } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether the reader has asked for less motion. CSS animations and transitions honour this on
 * their own, but anything driven from JavaScript — the market tape, the pulse on a surface
 * marker — has to ask, or it keeps moving for someone who asked it not to.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}