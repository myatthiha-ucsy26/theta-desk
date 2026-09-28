import { useEffect, useState } from "react";
import { BotIcon } from "@/components/shared/Icons";
import { Panel } from "@/components/shared/Panel";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { api, type BotStatus } from "@/lib/infra/api";
import { botBadge } from "@/lib/domain/bot";
import { toast } from "@/lib/infra/toast";
import { formatMoney } from "@/lib/domain/views";
import { BTN, BTN_DANGER } from "@/lib/infra/ui";
import { CONFIRM_MS } from "./constants";

/**
 * What the bot is doing right now, read off the same status the header badge polls.
 *
 * The mockup drew this panel as a row of switches for the daemons behind the bot — OpenD, the AI
 * guard, the settle rule, the loop. The app has no such switches: those are one background thread
 * with no sub-controls, and OpenD is a process the app talks to rather than owns. So this reads
 * their state instead of pretending to set it.
 *
 * One control is left, and it is the one that cannot be reached from anywhere else on a phone:
 * closing the book. Stopping and resuming entries is not repeated here because the folio line
 * carries it on every screen already, and two buttons for one action is one too many.
 */
export function ExecutionController({ bot, onRefresh }: { bot: BotStatus; onRefresh: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The confirm disarms itself: a destructive button left armed is one you can hit by coming back
  // to the window, and the book it closes is real.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  async function exitAll() {
    setConfirming(false);
    try {
      const r = await api.closeAllBot();
      const msg = `Closing ${r.closing} ${r.closing === 1 ? "position" : "positions"}`;
      setMessage(msg);
      toast(msg);
      onRefresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <BotIcon />
          Execution controller
        </span>
      }
      actions={<StatusBadge {...botBadge(bot)} />}
    >
      <dl className="flex flex-col">
        <ControllerRow
          label="Entries"
          value={bot.paused ? "Paused" : "Live"}
          sub={bot.paused ? bot.pause_reason : "taking new spreads"}
        />
        <ControllerRow
          label="Mode"
          value={bot.mode}
          sub={bot.mode === "auto" ? "opened by the engine" : "entries placed by you"}
        />
        <ControllerRow
          label="Monitor"
          value={bot.monitor.state}
          sub={bot.monitor.last_error ?? "no errors"}
        />
        <ControllerRow
          label="Slots"
          value={`${bot.active.length} of ${bot.slots}`}
          sub={`next slot at ${formatMoney(bot.next_slot_at, { signed: false })}`}
        />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        {confirming ? (
          <>
            <button type="button" onClick={exitAll} className={`flex-1 justify-center ${BTN_DANGER}`}>
              Yes, close all at market
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`flex-1 justify-center ${BTN}`}
            >
              Keep them
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`flex-1 justify-center ${BTN_DANGER}`}
          >
            Emergency exit
          </button>
        )}
      </div>

      {message && <p className="mt-3 text-sm text-ink-2">{message}</p>}
    </Panel>
  );
}

/** One reading on the controller: what is being reported, then the figure and the note under it. */
export function ControllerRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="flex min-w-0 flex-col items-end">
        <span className="num text-sm text-ink">{value}</span>
        <span className="stat-sub max-w-full truncate">{sub}</span>
      </dd>
    </div>
  );
}
