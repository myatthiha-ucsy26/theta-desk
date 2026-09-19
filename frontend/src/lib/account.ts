// Which account the desk is trading. Pure; the components only draw it.
import type { Tone } from "../components/StatusBadge";
import type { Account, AccountMode } from "./api";

/**
 * The account stamp for the folio line.
 *
 * Live reads as a warning rather than as "good": nothing has gone wrong, but it
 * is the state where a mistake costs money, and the badge is the one place that
 * is always on screen to say so.
 */
export function accountBadge(mode: AccountMode | undefined | null): { tone: Tone; label: string; hint: string } {
  if (mode === "live") {
    return { tone: "warn", label: "Live account", hint: "Orders go to the real account" };
  }
  if (mode === "paper") {
    return { tone: "neutral", label: "Paper account", hint: "Fills are simulated; no money moves" };
  }
  return { tone: "neutral", label: "Account —", hint: "Account not known yet" };
}

/** Buying power, whichever account reported it. */
export function buyingPower(account: Account | null): number | null {
  if (!account) return null;
  const value = account.account === "paper" ? account.power : account.buying_power;
  return typeof value === "number" ? value : null;
}

/** What the book on screen belongs to, for a panel heading. */
export function bookLabel(mode: AccountMode | undefined | null): string {
  return mode === "live" ? "Live book" : "Paper book";
}

/** The same thing in one word, for a count chip: "1 paper", "3 live". */
export function bookWord(mode: AccountMode | undefined | null): string {
  return mode === "live" ? "live" : "paper";
}

/**
 * Whether switching to `wanted` is worth warning about first.
 * Going live is the direction that needs a second thought; coming back does not.
 */
export function needsLiveConfirmation(current: AccountMode, wanted: AccountMode): boolean {
  return current !== "live" && wanted === "live";
}
