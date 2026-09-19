// The IV surface read as a table: one row per strike, one column per expiry. Pure.
import type { IvSurface, Spread } from "./api";
import { nearestIndex } from "./surfaceLabels";

/** Which strike the row is: a leg of the studied spread, or the money. */
export type SmileTag = "short" | "long" | "atm";

export interface SmileRow {
  strike: number;
  tag: SmileTag | null;
  /** One IV per column, in the same order as the surface's `dtes`. */
  iv: (number | null)[];
}

/**
 * The surface transposed. The grid comes back expiry-major because the 3D mesh walks it
 * that way; the table reads strike-major, one row per strike.
 *
 * A strike the studied spread sits on is tagged S or L; the strike nearest spot is ATM.
 * Short wins a tie — it is the strike the trade is priced on.
 */
export function smileRows(surface: IvSurface, spread?: Spread | null): SmileRow[] {
  const atm = nearestIndex(surface.strikes, surface.spot);
  return surface.strikes.map((strike, col) => {
    const tag: SmileTag | null =
      spread && strike === spread.short
        ? "short"
        : spread && strike === spread.long
          ? "long"
          : col === atm
            ? "atm"
            : null;
    return { strike, tag, iv: surface.iv.map((row) => row[col] ?? null) };
  });
}

/** The money IV for each expiry: the column of the strike nearest spot. */
export function atmIv(surface: IvSurface): (number | null)[] {
  const col = nearestIndex(surface.strikes, surface.spot);
  if (col < 0) return surface.expiries.map(() => null);
  return surface.iv.map((row) => row[col] ?? null);
}

export interface SmileReadings {
  /** The expiry nearest the one being studied — where the skew below was taken. */
  dte: number | null;
  /** The put wing's IV over the call wing's: what the downside costs over the upside. */
  skew: number | null;
  /** The expiry whose money IV is highest — where the premium on sale is richest. */
  richest: { dte: number; iv: number } | null;
}

/**
 * Two readings off the smile, both as decimals of IV.
 *
 * The skew is the two wings against each other, not a wing against the money: at ±10% out
 * a put simply carries more vol, and calling that difference "skew" would report the smile's
 * height rather than its lean. Each wing is the furthest strike the surface returned on its
 * side, so the comparison is symmetric and needs no invented moneyness.
 */
export function smileReadings(surface: IvSurface, dte: number): SmileReadings {
  const atm = atmIv(surface);
  const i = nearestIndex(surface.dtes, dte);
  const row = i < 0 ? null : surface.iv[i] ?? null;

  // The surface returns puts at or below spot and calls at or above it, so the extremes of
  // each side are that side's wing — on a window with only one side quoted, there is no lean.
  const puts = surface.strikes.filter((k) => k < surface.spot);
  const calls = surface.strikes.filter((k) => k > surface.spot);
  const putIv = row && puts.length > 0 ? row[surface.strikes.indexOf(Math.min(...puts))] ?? null : null;
  const callIv = row && calls.length > 0 ? row[surface.strikes.indexOf(Math.max(...calls))] ?? null : null;

  let richest: SmileReadings["richest"] = null;
  atm.forEach((iv, k) => {
    if (iv === null || k >= surface.dtes.length) return;
    if (richest === null || iv > richest.iv) richest = { dte: surface.dtes[k], iv };
  });

  return {
    dte: i < 0 ? null : surface.dtes[i],
    skew: putIv === null || callIv === null ? null : putIv - callIv,
    richest,
  };
}