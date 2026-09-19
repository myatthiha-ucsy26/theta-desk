import type { BotStatus } from "../lib/api";
import { formatTime } from "../lib/time";
import { Panel } from "./Panel";

/**
 * Every order the bot sent, as the feed that runs beside its controls.
 *
 * The log is the bot's own telemetry, and in the terminal the dock is where telemetry goes: the
 * orders belong next to the switch that stops them, not folded away under the list of what they
 * bought. It is read off the same status the controller reads, so it needs no poll of its own.
 *
 * Only the terminal shows this panel — the cockpit's rail is the only place it has to sit. The
 * broadsheet keeps the log where it was, folded under the bot's own table.
 */
export function OrderLogPanel({ bot }: { bot: BotStatus }) {
  const { events } = bot;
  return (
    <Panel
      title="Order log"
      actions={<span className="chip">{events.length} {events.length === 1 ? "order" : "orders"}</span>}
    >
      {events.length === 0 ? (
        <p className="text-sm text-ink-2">The bot has not sent an order yet.</p>
      ) : (
        // Oldest first, the way the panel below has always listed them: the feed scrolls, and the
        // row you are looking for is usually the one you just triggered.
        <ul className="log flex max-h-80 flex-col gap-2 overflow-y-auto">
          {events.map((e) => (
            <li key={e.id} className="border-b border-rule pb-2 last:border-b-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="num text-xs text-ink">{e.action}</span>
                <span className="num text-xs text-ink-2">{formatTime(e.ts)}</span>
              </div>
              <div className="flex items-baseline gap-2 text-xs text-ink-2">
                <span>{e.status}</span>
                {e.price !== null && <span className="num">${e.price.toFixed(2)}</span>}
                {e.reason && (
                  <span className="truncate" title={e.reason}>
                    {e.reason}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}