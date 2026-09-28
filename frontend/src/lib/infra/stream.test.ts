import { describe, it, expect } from "vitest";
import { parseStreamEvent } from "./stream";

describe("parseStreamEvent", () => {
  it("reads a log line", () => {
    expect(parseStreamEvent("log", '{"step":"data","msg":"Spot: $470.00"}'))
      .toEqual({ kind: "log", step: "data", msg: "Spot: $470.00" });
  });

  it("reads a result and unwraps its data", () => {
    expect(parseStreamEvent("result", '{"data":{"ticker":"SPY"}}'))
      .toEqual({ kind: "result", data: { ticker: "SPY" } });
  });

  it("reads an abort", () => {
    expect(parseStreamEvent("abort", '{"msg":"No ATM IV available"}'))
      .toEqual({ kind: "abort", msg: "No ATM IV available" });
  });

  it("turns malformed JSON into an abort", () => {
    expect(parseStreamEvent("log", "{not json"))
      .toEqual({ kind: "abort", msg: "The server sent an unreadable update." });
  });

  it("turns an empty line into an abort", () => {
    expect(parseStreamEvent("log", ""))
      .toEqual({ kind: "abort", msg: "The server sent an unreadable update." });
  });

  it("turns a log without a message into an abort", () => {
    expect(parseStreamEvent("log", '{"step":"data"}'))
      .toEqual({ kind: "abort", msg: "The server sent an unreadable update." });
  });

  it("turns a result without data into an abort", () => {
    expect(parseStreamEvent("result", '{"nope":1}'))
      .toEqual({ kind: "abort", msg: "The server sent an unreadable update." });
  });

  it("ignores an event type it does not know", () => {
    expect(parseStreamEvent("ping", "{}")).toEqual({ kind: "ignore" });
  });
});