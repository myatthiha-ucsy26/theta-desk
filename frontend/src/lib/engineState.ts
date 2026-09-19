// The engine's state string -> what a person reads. Pure.
import type { Tone } from "../components/StatusBadge";

const STATES: Record<string, { tone: Tone; label: string }> = {
  idle: { tone: "neutral", label: "Waiting for next cycle" },
  scanning: { tone: "good", label: "Scanning" },
  "building edge table": { tone: "neutral", label: "Building edge table" },
  disabled: { tone: "neutral", label: "Off" },
  "market closed": { tone: "neutral", label: "Market closed" },
  error: { tone: "critical", label: "Error" },
  "not started": { tone: "neutral", label: "Engine not started" },
  stopped: { tone: "neutral", label: "Engine not started" },
};

/** An unknown state still shows something, in a neutral badge, rather than nothing. */
export function engineState(state: string | null | undefined): { tone: Tone; label: string } {
  if (!state) return STATES["not started"];
  return STATES[state] ?? { tone: "neutral", label: state };
}