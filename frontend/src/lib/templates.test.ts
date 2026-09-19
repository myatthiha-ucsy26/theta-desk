import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE, resolveTemplate } from "./templates";

describe("resolveTemplate", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(resolveTemplate(null)).toBe(DEFAULT_TEMPLATE);
  });

  it("uses a stored choice", () => {
    expect(resolveTemplate("broadsheet")).toBe("broadsheet");
    expect(resolveTemplate("minimal")).toBe("minimal");
  });

  it("ignores a stored value it does not know", () => {
    expect(resolveTemplate("cockpit")).toBe(DEFAULT_TEMPLATE);
  });
});