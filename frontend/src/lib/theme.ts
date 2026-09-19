// Light or dark: the system's choice until the viewer picks one, then theirs (remembered).
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "theme";
const QUERY = "(prefers-color-scheme: dark)";

/** A stored choice wins; anything else falls back to the system setting. */
export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemDark ? "dark" : "light";
}

// Storage can be missing or throw (private windows, blocked site data); the theme still works.
function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

const listeners = new Set<() => void>();
let current: Theme = typeof window === "undefined" ? "light" : resolveTheme(readStored(), systemDark());

function apply(theme: Theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  document.documentElement.dataset.theme = current;
  if (typeof window.matchMedia === "function") {
    window.matchMedia(QUERY).addEventListener("change", (e) => {
      if (readStored() === null) apply(e.matches ? "dark" : "light");
    });
  }
}

export function setTheme(theme: Theme) {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered, but still applied for this visit.
  }
  apply(theme);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current, () => "light");
}
