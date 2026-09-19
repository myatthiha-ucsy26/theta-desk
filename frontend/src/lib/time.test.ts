import { describe, expect, it } from "vitest";
import { formatDate, formatTime, marketHours } from "./time";

const SG = "Asia/Singapore"; // UTC+8, no daylight saving

describe("formatTime", () => {
  it("shows only the 12-hour time for a timestamp from today", () => {
    const now = new Date("2026-09-16T15:00:00+00:00"); // 11:00 PM in Singapore
    expect(formatTime("2026-09-16T14:00:00+00:00", now, SG)).toBe("10:00 PM");
  });

  it("adds month and day for other days", () => {
    const now = new Date("2026-09-16T15:00:00+00:00");
    expect(formatTime("2026-09-15T01:05:00+00:00", now, SG)).toBe("Sep 15, 9:05 AM");
  });

  it("decides 'today' in the viewer's time zone, not UTC", () => {
    // 17:30 UTC on Sep 15 is already 1:30 AM on Sep 16 in Singapore.
    const now = new Date("2026-09-16T03:00:00+00:00");
    expect(formatTime("2026-09-15T17:30:00+00:00", now, SG)).toBe("1:30 AM");
  });

  it("never uses 24-hour format and uses a plain space before AM/PM", () => {
    const out = formatTime("2026-09-16T12:00:00+00:00", new Date("2026-09-16T12:00:00+00:00"), SG);
    expect(out).toBe("8:00 PM");
    expect(out).not.toMatch(/ /);
  });

  it("returns an em dash for a missing timestamp", () => {
    expect(formatTime(null, new Date(), SG)).toBe("—");
  });
});

describe("formatDate", () => {
  it("reads a date-only value as a calendar date, not a UTC instant", () => {
    // Parsed as UTC this would be Sep 22 evening in New York — the wrong expiry.
    expect(formatDate("2026-09-23")).toBe("Sep 23");
  });

  it("returns an em dash for a missing date", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("marketHours", () => {
  it("shows US regular hours in local time during daylight saving", () => {
    expect(marketHours(new Date("2026-09-16T10:00:00+00:00"), SG)).toEqual({ open: "9:30 PM", close: "4:00 AM" });
  });

  it("shifts by an hour once the US leaves daylight saving", () => {
    expect(marketHours(new Date("2026-01-14T10:00:00+00:00"), SG)).toEqual({ open: "10:30 PM", close: "5:00 AM" });
  });
});
