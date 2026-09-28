import { useEffect, useState } from "react";
import { api, type BotStatus } from "@/lib/infra/api";
import { botBadge } from "@/lib/domain/bot";
import { onSettingsSaved } from "@/lib/infra/settingsBus";
import { usePoll } from "@/lib/hooks/usePoll";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/lib/infra/toast";
import { BTN, BTN_DANGER } from "@/lib/infra/ui";

const POLL_MS = 15000;

/** Live bot state, with the one control that must always be one click away: stop. */
export function BotControl() {
  const poll = usePoll(() => api.bot(), POLL_MS);
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (poll.data) setBot(poll.data);
  }, [poll.data]);

  // Live trading can be switched on in Settings; don't sit on "Bot off" until the next poll.
  useEffect(() => onSettingsSaved(() => void poll.refresh()), [poll.refresh]);

  async function run(action: () => Promise<BotStatus>, done: string) {
    setBusy(true);
    setError(null);
    try {
      setBot(await action());
      toast(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const badge = botBadge(bot);
  return (
    <span className="flex items-center gap-2">
      <StatusBadge {...badge} />
      {bot?.mode === "auto" && !bot.paused && (
        <button type="button" disabled={busy} onClick={() => run(api.stopBot, "Trading stopped")}
          className={BTN_DANGER}>
          Stop trading
        </button>
      )}
      {bot?.mode === "auto" && bot.paused && (
        <button type="button" disabled={busy} onClick={() => run(api.resumeBot, "Trading resumed")}
          className={BTN}>
          Resume
        </button>
      )}
      {error && <span className="text-xs text-critical">{error}</span>}
    </span>
  );
}
