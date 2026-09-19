import { useEffect, useRef, useState } from "react";
import { api, type AiVerdict, type Signal, type SignalMode, type SizePreview } from "../lib/api";
import { hrefFor } from "../lib/route";
import { formatDate } from "../lib/time";
import { formatMoney, riskMeter, spreadLabel } from "../lib/views";
import { StatusBadge } from "./StatusBadge";
import { toast } from "../lib/toast";
import { BTN } from "../lib/ui";

export interface SizeDrawerProps {
  signal: Signal;
  modes: SignalMode[];
  aiVerdict: AiVerdict | null;
  onClose: () => void;
}

const HATCH = "repeating-linear-gradient(135deg, var(--color-warn) 0 3px, transparent 3px 6px)";
const HATCH_OVER =
  "repeating-linear-gradient(135deg, var(--color-critical) 0 3px, transparent 3px 6px)";

const PRIMARY_BUTTON =
  "inline-flex items-center gap-1.5 border border-profit bg-profit px-3 py-1.5 text-sm text-sheet transition-colors hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Sizes the signal against the risk limits, then records it in the paper book.
 * Everything here comes from the server's preview: the drawer never guesses a size.
 */
export function SizeDrawer({ signal, modes, aiVerdict, onClose }: SizeDrawerProps) {
  const [preview, setPreview] = useState<SizePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLElement | null>(null);

  // Focus moves into the drawer, and Escape anywhere in it closes it.
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    api
      .sizePreview(signal.ticker, signal)
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [signal]);

  const spread = signal.spread;

  async function record() {
    if (!preview?.ok || !spread || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.openPaper({
        ticker: signal.ticker,
        direction: signal.direction,
        short_strike: spread.short,
        long_strike: spread.long,
        width: spread.width,
        credit: spread.credit,
        contracts: preview.contracts,
        expiry: signal.expiration,
        mode: modes.join("+"),
        entry_context: {
          source: "study",
          dte_target: signal.dte,
          spot: signal.spot,
          iv_pct: signal.iv_pct,
          iv_rank: signal.iv_rank,
          iv_rv: signal.iv_rv ?? null,
          indicators: signal.indicators ?? null,
          verdicts: signal.verdicts,
          expected_move: signal.expected_move ?? null,
          ...(aiVerdict ? { ai_verdict: aiVerdict.verdict } : {}),
          sized_at: new Date().toISOString(),
        },
      });
      toast(`Recorded ${signal.ticker} paper trade`);
      onClose();
      window.location.hash = hrefFor("manage");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const blocked = preview !== null && !preview.ok;
  const after = preview ? riskMeter(preview.deployed_after, preview.cap) : null;
  const before = preview ? riskMeter(preview.deployed_before, preview.cap) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/20" aria-hidden="true" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Size this trade"
        tabIndex={-1}
        className="animate-drawer relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-sheet shadow-[var(--shadow-lift)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink px-5 py-3">
          <h2 className="font-display text-[21px] font-semibold tracking-[-0.01em] text-ink">Size this trade</h2>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </header>

        <div className="flex-1 px-5 py-4">
          {error && <p className="text-sm text-critical">{error}</p>}

          {spread && (
            <>
              <p className="figure text-[26px] leading-tight text-ink">
                {spreadLabel(signal.direction)}{" "}
                {formatMoney(spread.short, { signed: false })}/
                {formatMoney(spread.long, { signed: false })}
              </p>
              <p className="mt-1 text-sm text-ink-2">
                {signal.ticker} expires {formatDate(signal.expiration)}, {signal.dte} days out.
              </p>
            </>
          )}

          {preview && (
            <>
              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                <Figure label="Contracts" value={String(preview.contracts)} />
                <Figure
                  label="Credit collected"
                  value={formatMoney(preview.credit_total, { signed: false })}
                />
                <Figure
                  label="Risk on this trade"
                  value={formatMoney(preview.trade_risk, { signed: false })}
                />
              </dl>

              <div className="mt-5">
                <p className="eyebrow">Deployed risk</p>
                <p className="mt-1 text-sm text-ink">
                  {formatMoney(preview.deployed_before, { signed: false })} →{" "}
                  {formatMoney(preview.deployed_after, { signed: false })} of{" "}
                  {formatMoney(preview.cap, { signed: false })}
                </p>
                <div className="mt-2 h-2 w-full overflow-hidden border border-rule bg-well">
                  <div className="flex h-full">
                    <span
                      aria-hidden="true"
                      className="h-full bg-ink-2"
                      style={{ width: `${before?.pct ?? 0}%` }}
                    />
                    <span
                      aria-hidden="true"
                      className="h-full"
                      style={{
                        width: `${Math.max(0, (after?.pct ?? 0) - (before?.pct ?? 0))}%`,
                        backgroundImage: after?.over ? HATCH_OVER : HATCH,
                      }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-sm text-ink-2">
                  {preview.open_positions} of {preview.max_open_positions} open
                </p>
              </div>

              {blocked && (
                <div className="mt-5">
                  <StatusBadge tone="critical" label="Blocked by risk limits" />
                  <p className="mt-2 text-sm text-ink">{preview.reason}</p>
                </div>
              )}
            </>
          )}

          {!preview && !error && <p className="text-sm text-ink-2">Sizing…</p>}
        </div>

        <footer className="sticky bottom-0 border-t border-ink bg-sheet px-5 py-3">
          {saveError && <p className="mb-2 text-sm text-critical">{saveError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={BTN}>
              Cancel
            </button>
            <button
              type="button"
              onClick={record}
              disabled={!preview?.ok || saving}
              className={PRIMARY_BUTTON}
            >
              Record paper trade
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="figure text-[17px] text-ink">{value}</dd>
    </div>
  );
}