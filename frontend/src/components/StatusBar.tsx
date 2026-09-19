import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { engineState } from "../lib/engineState";
import { onSettingsSaved } from "../lib/settingsBus";
import { isEngineBusy, nextScanLabel, scanNowView } from "../lib/scanNow";
import { formatTime, marketHours } from "../lib/time";
import { usePoll } from "../lib/usePoll";
import { BotControl } from "./BotControl";
import { StatusBadge } from "./StatusBadge";
import { toast } from "../lib/toast";

const POLL_MS = 15000;
const BUSY_POLL_MS = 3000;

/** One item of the folio line, carrying its own hairline so a wrapped line still reads as a list. */
function FolioItem({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <span className="flex items-center gap-4">
      {!first && <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-rule" />}
      {children}
    </span>
  );
}

/**
 * The folio line: everything the desk is doing right now, set as one dense band of small
 * caps over the market tape — engine state, the clock the engine runs on, and the switch
 * that must always be a click away. Scanning is driven from the Scan board; this line only
 * says whether a scan can run.
 */
export function StatusBar() {
  const [fast, setFast] = useState(false);
  const { data, error, loading, refresh } = usePoll(() => api.engineStatus(), fast ? BUSY_POLL_MS : POLL_MS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Until the first status lands we know nothing: never show the switch as off.
  const unknown = !data && loading;
  const on = data?.engine_enabled ?? false;
  const hours = marketHours();
  const scanHint = scanNowView(data, false).hint;
  const nextScan = nextScanLabel(data);

  useEffect(() => setFast(isEngineBusy(data?.state)), [data?.state]);

  // A save on another screen can change this switch; don't sit stale until the next poll.
  useEffect(() => onSettingsSaved(() => void refresh()), [refresh]);

  async function toggle() {
    if (!data || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveSettings({ engine_enabled: !on });
      toast(on ? "Engine turned off" : "Engine turned on");
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-rule py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FolioItem first>
          {unknown ? (
            <StatusBadge tone="neutral" label="Checking engine…" />
          ) : error && !data ? (
            <StatusBadge tone="critical" label="Engine unreachable" />
          ) : (
            <StatusBadge {...engineState(data?.state)} />
          )}
        </FolioItem>

        <FolioItem>
          <BotControl />
        </FolioItem>

        <FolioItem>
          <span className="eyebrow text-[11px] text-ink">Last cycle {formatTime(data?.last_cycle)}</span>
        </FolioItem>

        {nextScan && (
          <FolioItem>
            <span className="eyebrow text-[11px]">{nextScan}</span>
          </FolioItem>
        )}

        <FolioItem>
          <span className="eyebrow text-[11px] text-ink">US market {hours.open}–{hours.close}</span>
        </FolioItem>

        <span className="ml-auto flex items-center gap-2.5">
          <span className="eyebrow text-[11px] text-ink">Engine</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-busy={unknown || undefined}
            aria-label="Engine"
            disabled={saving || !data}
            onClick={toggle}
            className={`border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.11em] transition-colors ${
              unknown
                ? "animate-pulse border-rule-strong text-ink-2"
                : on
                  ? "border-ink bg-ink text-sheet"
                  : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink"
            } ${saving || !data ? "opacity-50" : ""}`}
          >
            {unknown ? "…" : on ? "On" : "Off"}
          </button>
        </span>
      </div>

      {scanHint && <p className="mt-1.5 text-xs text-ink-2">{scanHint}</p>}

      {data?.last_error && (
        <p className="mt-2">
          <StatusBadge tone="critical" label={`Last error: ${data.last_error}`} />
        </p>
      )}
      {saveError && <p className="mt-2 text-sm text-critical">{saveError}</p>}
      {!data && error && <p className="mt-2 text-sm text-critical">{error}</p>}
    </div>
  );
}