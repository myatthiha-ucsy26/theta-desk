import { describe, expect, it } from "vitest";
import type { IvSurface, Spread } from "./api";
import { atmIv, smileReadings, smileRows } from "./smile";

const surface: IvSurface = {
  ticker: "SPY", spot: 471.25,
  expiries: ["2026-09-23", "2026-09-30"],
  dtes: [7, 14],
  strikes: [465, 470, 475],
  iv: [
    [0.325, 0.301, null],
    [0.34, 0.318, 0.295],
  ],
  min_iv: 0.295, max_iv: 0.34,
};

const spread: Spread = {
  side: "put", short: 470, long: 465, width: 5, credit: 1.12, max_loss: 388, pop_pct: 68.2,
};

/** One strike, three expiries whose money IV climbs all the way, for the richest-term reading. */
function climbing(): IvSurface {
  return {
    ...surface,
    expiries: ["a", "b", "c"], dtes: [7, 14, 21],
    strikes: [470],
    iv: [[0.3], [0.33], [0.36]],
  };
}

describe("smileRows", () => {
  it("turns the expiry-major grid the mesh walks into one row per strike", () => {
    expect(smileRows(surface).map((r) => r.iv)).toEqual([
      [0.325, 0.34],
      [0.301, 0.318],
      [null, 0.295],
    ]);
  });

  it("keeps the strikes in the order the surface returned them", () => {
    expect(smileRows(surface).map((r) => r.strike)).toEqual([465, 470, 475]);
  });

  it("tags the strike nearest spot as the money when nothing is being studied", () => {
    expect(smileRows(surface).map((r) => r.tag)).toEqual([null, "atm", null]);
  });

  it("tags the two legs of the studied spread", () => {
    expect(smileRows(surface, spread).map((r) => r.tag)).toEqual(["long", "short", null]);
  });

  it("gives a strike that is both the money and a leg to the short, which prices the trade", () => {
    // Spot sits on the short strike, so 470 is the money as well as the short leg.
    expect(smileRows({ ...surface, spot: 470 }, spread).map((r) => r.tag)).toEqual([
      "long", "short", null,
    ]);
  });
});

describe("atmIv", () => {
  it("reads the column of the strike nearest spot, one value per expiry", () => {
    expect(atmIv(surface)).toEqual([0.301, 0.318]);
  });

  it("reports nothing at the money when the surface has no strikes", () => {
    expect(atmIv({ ...surface, strikes: [], iv: [[], []] })).toEqual([null, null]);
  });
});

describe("smileReadings", () => {
  it("reads the skew as the furthest put over the furthest call, at the expiry being studied", () => {
    expect(smileReadings(surface, 14)).toEqual({
      dte: 14,
      skew: expect.closeTo(0.34 - 0.295, 6), // the $465 put over the $475 call
      richest: { dte: 14, iv: 0.318 }, // money IV is 30.1% at 7d and 31.8% at 14d
    });
  });

  it("lets the skew go negative when the calls are the expensive wing", () => {
    const callsRich: IvSurface = { ...surface, iv: [[0.29, 0.3, 0.34], [0.28, 0.3, 0.33]] };
    expect(smileReadings(callsRich, 7).skew).toBeCloseTo(0.29 - 0.34, 6);
  });

  it("takes the expiry nearest the one being studied", () => {
    expect(smileReadings(surface, 9).dte).toBe(7);
    expect(smileReadings(surface, 11).dte).toBe(14);
  });

  it("names the term whose money carries the most premium", () => {
    // 30.0% at 7d, 33.0% at 14d, 36.0% at 21d: the far end is the richest.
    expect(smileReadings(climbing(), 7).richest).toEqual({ dte: 21, iv: 0.36 });
  });

  it("reports no skew when the window holds no put to lean it", () => {
    const callsOnly: IvSurface = { ...surface, strikes: [475, 480], iv: [[0.3], [0.29]] };
    expect(smileReadings(callsOnly, 7).skew).toBe(null);
  });

  it("reports no skew when the window holds no call to lean it against", () => {
    const putsOnly: IvSurface = { ...surface, strikes: [465, 470] };
    expect(smileReadings(putsOnly, 7).skew).toBe(null);
    // The money is still readable from the puts alone.
    expect(smileReadings(putsOnly, 7).richest).toEqual({ dte: 14, iv: 0.318 });
  });

  it("reports nothing at all when the surface has no expiries", () => {
    const empty: IvSurface = { ...surface, expiries: [], dtes: [], strikes: [], iv: [] };
    expect(smileReadings(empty, 7)).toEqual({ dte: null, skew: null, richest: null });
  });
});