import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    engineStatus: () => Promise.resolve({ running: true, state: "idle", engine_enabled: false, mode: "manual" }),
    scanLatest: () => Promise.resolve([]),
    paper: () => Promise.reject(new Error("offline")),
    settings: () => Promise.reject(new Error("offline")),
    account: () => Promise.reject(new Error("offline")),
    bot: () => Promise.reject(new Error("offline")),
  },
}));

import { setTemplate } from "../lib/templates";
import { setTheme } from "../lib/theme";
import { hrefFor } from "../lib/route";
import { Shell } from "./Shell";

afterEach(() => {
  cleanup();
  setTheme("light");
  setTemplate("broadsheet");
});

describe("Shell theme switch", () => {
  it("is a switch named Dark mode that flips the theme", async () => {
    setTheme("light");
    render(<Shell screen="scan"><p>content</p></Shell>);

    // The nav renders the switch twice (phone header and sidebar); either one works.
    const [sw] = await screen.findAllByRole("switch", { name: "Dark mode" });
    expect(sw.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(sw);
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getAllByRole("switch", { name: "Dark mode" })[0].getAttribute("aria-checked")).toBe("true");
  });
});

describe("Shell brand", () => {
  it("names the desk in the masthead", () => {
    render(<Shell screen="scan"><p>content</p></Shell>);
    expect(screen.getByRole("heading", { name: "Theta Desk" })).toBeTruthy();
  });

  it("sends the nameplate to the Scan screen", () => {
    // The nameplate is the way back to the desk's front page: the rail names the desk once, and so
    // does the masthead — one link to Scan in either template.
    for (const template of ["broadsheet", "minimal"] as const) {
      setTemplate(template);
      const { unmount } = render(<Shell screen="study"><p>content</p></Shell>);
      const brand = screen.getByRole("link", { name: "Theta Desk" });
      expect(brand.getAttribute("href")).toBe(hrefFor("scan"));
      unmount();
    }
  });
});

describe("Shell stat cards", () => {
  it("keeps the desk's figures to the Scan and Manage screens", async () => {
    // The paper and real books are the book's own screens' business: above Learn's funnel, Study's
    // one setup or Settings' rules they are two screens' worth of numbers nobody asked for there.
    for (const s of ["learn", "study", "settings"] as const) {
      for (const template of ["broadsheet", "minimal"] as const) {
        setTemplate(template);
        const { unmount } = render(<Shell screen={s}><p>content</p></Shell>);
        expect(screen.queryByRole("group", { name: "Paper book" })).toBeNull();
        expect(screen.queryByRole("group", { name: "Real account · moomoo" })).toBeNull();
        unmount();
      }
    }

    for (const s of ["scan", "manage"] as const) {
      const { unmount } = render(<Shell screen={s}><p>content</p></Shell>);
      expect(await screen.findByRole("group", { name: "Paper book" })).toBeTruthy();
      expect(screen.getByRole("group", { name: "Real account · moomoo" })).toBeTruthy();
      unmount();
    }
  });
});

describe("Shell in the Minimal template", () => {
  it("moves the sections into a rail and drops the section bar", async () => {
    setTemplate("minimal");
    render(<Shell screen="scan"><p>content</p></Shell>);

    const nav = await screen.findByRole("navigation", { name: "Screens" });
    // A desk-width rail link carries its descriptor under the name, so the link reads
    // "Scan Gates and decisions" — match on the name, not the whole accessible string.
    expect(within(nav).getByRole("link", { name: /^Scan\b/ }).getAttribute("aria-current")).toBe("page");
    // The nameplate carries the theme switch in the masthead; the rail carries it instead of
    // that second copy, so there is exactly one switch and exactly one name for the desk.
    expect(screen.getAllByRole("switch", { name: "Dark mode" })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Theta Desk" })).toHaveLength(1);
  });

  it("sets a glyph on the rail, and marks the section you are on", async () => {
    setTemplate("minimal");
    render(<Shell screen="study"><p>content</p></Shell>);

    const nav = await screen.findByRole("navigation", { name: "Screens" });
    const links = within(nav).getAllByRole("link");

    // Every section carries its own glyph, and no two carry the same one. It is decoration beside a
    // name the link already announces, so it sits in an aria-hidden span rather than joining the
    // accessible name.
    const glyphs = links.map((link) => link.querySelector(".rail-icon svg"));
    expect(glyphs.every((g) => g !== null)).toBe(true);
    expect(new Set(glyphs.map((g) => g?.innerHTML)).size).toBe(links.length);

    // The dot marks the current section at the far end of its row, where the eye lands after
    // reading the name.
    const current = within(nav).getByRole("link", { name: /^Study\b/ });
    expect(current.querySelector(".rail-dot")).not.toBeNull();
    expect(within(nav).getByRole("link", { name: /^Scan\b/ }).querySelector(".rail-dot")).toBeNull();
  });
});

describe("Shell in the Holo template", () => {
  // Shell lazy-loads HoloShell (motion library + WebGL orb). Cold, that import can take
  // longer than findByRole's 1s wait while the whole suite runs in parallel; load it once
  // here so no test depends on how busy the machine is.
  beforeAll(() => import("./holo/HoloShell"), 30_000);

  it("names the desk once, marks the section you are on, and has no theme switch", async () => {
    setTemplate("holo");
    render(<Shell screen="scan"><p>content</p></Shell>);

    const nav = await screen.findByRole("navigation", { name: "Screens" });
    expect(within(nav).getByRole("link", { name: "Scan" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("heading", { name: "Theta Desk" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Theta Desk" }).getAttribute("href")).toBe(hrefFor("scan"));
    // Holo is dark only: a switch that did nothing would be a lie.
    expect(screen.queryByRole("switch", { name: "Dark mode" })).toBeNull();
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("sets a 3D glyph beside each section, and no two alike", async () => {
    setTemplate("holo");
    render(<Shell screen="study"><p>content</p></Shell>);

    const nav = await screen.findByRole("navigation", { name: "Screens" });
    const glyphs = within(nav).getAllByRole("link").map((l) => l.querySelector("svg.icon-3d"));
    expect(glyphs.every((g) => g !== null)).toBe(true);
    expect(new Set(glyphs.map((g) => g?.innerHTML)).size).toBe(glyphs.length);
  });

  it("carries the holo band, with the book's figures, on Scan and Manage only", async () => {
    setTemplate("holo");
    for (const s of ["scan", "manage"] as const) {
      const { unmount } = render(<Shell screen={s}><p>content</p></Shell>);
      expect(await screen.findByRole("group", { name: "Paper book" })).toBeTruthy();
      expect(screen.getByRole("group", { name: "Real account · moomoo" })).toBeTruthy();
      unmount();
    }
    for (const s of ["learn", "study", "settings"] as const) {
      const { unmount } = render(<Shell screen={s}><p>content</p></Shell>);
      await screen.findByRole("navigation", { name: "Screens" });
      expect(screen.queryByRole("group", { name: "Paper book" })).toBeNull();
      unmount();
    }
  });
});
