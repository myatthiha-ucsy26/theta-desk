import { describe, expect, it } from "vitest";
import { engineState } from "./engineState";

describe("engineState", () => {
  it("names each engine state in plain words", () => {
    expect(engineState("idle").label).toBe("Waiting for next cycle");
    expect(engineState("scanning").label).toBe("Scanning");
    expect(engineState("building edge table").label).toBe("Building edge table");
    expect(engineState("disabled").label).toBe("Off");
    expect(engineState("market closed").label).toBe("Market closed");
    expect(engineState("error").label).toBe("Error");
    expect(engineState("not started").label).toBe("Engine not started");
    expect(engineState("stopped").label).toBe("Engine not started");
  });

  it("reserves the critical tone for errors and good for work in progress", () => {
    expect(engineState("error").tone).toBe("critical");
    expect(engineState("scanning").tone).toBe("good");
    expect(engineState("idle").tone).toBe("neutral");
    expect(engineState("disabled").tone).toBe("neutral");
    expect(engineState("market closed").tone).toBe("neutral");
    expect(engineState("building edge table").tone).toBe("neutral");
    expect(engineState("not started").tone).toBe("neutral");
  });

  it("falls back to a neutral badge for a state it does not know", () => {
    expect(engineState("reticulating")).toEqual({ tone: "neutral", label: "reticulating" });
    expect(engineState(undefined).label).toBe("Engine not started");
  });
});