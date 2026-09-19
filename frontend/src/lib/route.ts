// Hash routing: #/scan, #/study?ticker=SPY&dte=14, #/manage, #/learn, #/settings.
import { useEffect, useState } from "react";

export const SCREENS = ["scan", "study", "manage", "learn", "settings"] as const;
export type Screen = (typeof SCREENS)[number];
export interface Route { screen: Screen; params: Record<string, string> }

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const screen = (SCREENS as readonly string[]).includes(path) ? (path as Screen) : "scan";
  return { screen, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function hrefFor(screen: Screen, params: Record<string, string | number> = {}): string {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return `#/${screen}${query ? `?${query}` : ""}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
