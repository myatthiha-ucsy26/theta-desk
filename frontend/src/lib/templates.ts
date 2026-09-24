// Which template the desk is set in — the look, not the behaviour. Remembered like the theme.
import { useSyncExternalStore } from "react";
import { forceTheme } from "./theme";

export type TemplateId = "broadsheet" | "minimal" | "holo";

/** The templates on offer, in the order the picker lists them. The first is the default. */
export const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: "broadsheet", label: "Template 1 · Broadsheet" },
  { id: "minimal", label: "Template 2 · Minimal" },
  { id: "holo", label: "Template 3 · Holo" },
];

/** Holo is neon on deep navy: it has no day edition, so it holds the page dark. */
const DARK_ONLY: TemplateId[] = ["holo"];

export const DEFAULT_TEMPLATE: TemplateId = TEMPLATES[0].id;

const KEY = "template";

/** A stored choice wins if it still names a template; anything else falls back to the default. */
export function resolveTemplate(stored: string | null): TemplateId {
  return TEMPLATES.some((t) => t.id === stored) ? (stored as TemplateId) : DEFAULT_TEMPLATE;
}

// Storage can be missing or throw (private windows, blocked site data); the template still works.
function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let current: TemplateId =
  typeof window === "undefined" ? DEFAULT_TEMPLATE : resolveTemplate(readStored());

function apply(id: TemplateId) {
  current = id;
  document.documentElement.dataset.template = id;
  forceTheme(DARK_ONLY.includes(id) ? "dark" : null);
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  document.documentElement.dataset.template = current;
  if (DARK_ONLY.includes(current)) forceTheme("dark");
}

export function setTemplate(id: TemplateId) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Not remembered, but still applied for this visit.
  }
  apply(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTemplate(): TemplateId {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_TEMPLATE);
}