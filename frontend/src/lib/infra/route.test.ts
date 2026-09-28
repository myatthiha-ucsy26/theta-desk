import { describe, expect, it } from "vitest";
import { hrefFor, parseRoute } from "./route";

describe("parseRoute", () => {
  it("defaults to the scan board", () => {
    expect(parseRoute("")).toEqual({ screen: "scan", params: {} });
    expect(parseRoute("#/")).toEqual({ screen: "scan", params: {} });
    expect(parseRoute("#/nonsense")).toEqual({ screen: "scan", params: {} });
  });

  it("reads the screen and its query parameters", () => {
    expect(parseRoute("#/study?ticker=META&dte=7")).toEqual({ screen: "study", params: { ticker: "META", dte: "7" } });
    expect(parseRoute("#/settings")).toEqual({ screen: "settings", params: {} });
  });
});

describe("hrefFor", () => {
  it("builds hash links, encoding parameters", () => {
    expect(hrefFor("manage")).toBe("#/manage");
    expect(hrefFor("study", { ticker: "BRK.B", dte: 14 })).toBe("#/study?ticker=BRK.B&dte=14");
  });

  it("round-trips through parseRoute", () => {
    expect(parseRoute(hrefFor("study", { ticker: "SPY", dte: 7 }))).toEqual({ screen: "study", params: { ticker: "SPY", dte: "7" } });
  });
});
