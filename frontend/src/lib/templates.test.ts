import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE, TEMPLATES, resolveTemplate, setTemplate } from "./templates";
import { setTheme } from "./theme";

describe("resolveTemplate", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(resolveTemplate(null)).toBe(DEFAULT_TEMPLATE);
  });

  it("uses a stored choice", () => {
    expect(resolveTemplate("broadsheet")).toBe("broadsheet");
    expect(resolveTemplate("minimal")).toBe("minimal");
    expect(resolveTemplate("holo")).toBe("holo");
  });

  it("ignores a stored value it does not know", () => {
    expect(resolveTemplate("cockpit")).toBe(DEFAULT_TEMPLATE);
  });

  it("lists Holo third", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["broadsheet", "minimal", "holo"]);
  });
});

describe("Holo is dark only", () => {
  afterEach(() => {
    setTemplate("broadsheet");
    setTheme("light");
  });

  it("sets the page dark whatever the stored theme, and gives the stored theme back after", () => {
    setTheme("light");
    setTemplate("holo");
    expect(document.documentElement.dataset.theme).toBe("dark");

    // Picking a theme while Holo is up is remembered, but the page stays dark.
    setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("dark");

    setTemplate("minimal");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
