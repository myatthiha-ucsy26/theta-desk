// Short-lived confirmations after a button does something, so a click never feels unanswered.
import { useSyncExternalStore } from "react";

export type ToastTone = "good" | "critical";
export interface Toast { id: number; tone: ToastTone; message: string }

export const TOAST_MS = 3500;

const listeners = new Set<() => void>();
let toasts: Toast[] = [];
let nextId = 1;

function set(next: Toast[]) {
  toasts = next;
  listeners.forEach((l) => l());
}

export function dismissToast(id: number) {
  set(toasts.filter((t) => t.id !== id));
}

export function toast(message: string, tone: ToastTone = "good") {
  const id = nextId++;
  set([...toasts, { id, tone, message }]);
  setTimeout(() => dismissToast(id), TOAST_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NONE: Toast[] = [];

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => NONE);
}
