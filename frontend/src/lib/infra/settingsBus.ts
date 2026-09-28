// Settings are read by several components, and a save in one place changes what the
// others should show: the header's engine switch and bot badge both come from here.
// Readers listen instead of waiting out their poll interval, so nothing keeps showing
// a value that was just superseded.
type Listener = () => void;

const listeners = new Set<Listener>();

/** Re-read whatever you show from settings when told they were saved. Returns an unsubscribe function. */
export function onSettingsSaved(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Settings were saved, so anything derived from them is now out of date. */
export function announceSettingsSaved(): void {
  for (const fn of listeners) fn();
}