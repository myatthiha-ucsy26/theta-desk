import { useEffect, useState } from "react";

/** Whether a media query matches, kept current. False where there is no matchMedia (tests). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Wide enough to spend a GPU on the orb; below it the orb is drawn in CSS. */
export const useDeskWidth = () => useMedia("(min-width: 900px)");
