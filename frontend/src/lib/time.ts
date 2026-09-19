// Display-only time formatting. Stored timestamps stay ISO-8601 UTC (spec §6.2).

const NEW_YORK = "America/New_York";

function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// ICU formats "10:00 PM" with a narrow no-break space; normalise to a plain space.
function clean(s: string): string {
  return s.replace(/[  ]/g, " ");
}

function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function clock(d: Date, timeZone: string): string {
  return clean(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(d));
}

/** "10:00 PM" for today, "Sep 15, 10:00 PM" otherwise, in the viewer's time zone. */
export function formatTime(iso: string | null | undefined, now: Date = new Date(), timeZone: string = viewerZone()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (dayKey(d, timeZone) === dayKey(now, timeZone)) return clock(d, timeZone);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(d);
  return `${date}, ${clock(d, timeZone)}`;
}

/**
 * "Sep 23" for a date-only value ("2026-09-23"), as the API sends expirations.
 * A date-only string is a calendar date, not an instant: `new Date("2026-09-23")` is UTC
 * midnight, which renders as Sep 22 evening in New York — the wrong expiry.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

/** "FRI" for a date-only value, so an expiry reads as the session it lands on. */
export function weekdayShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(y, m - 1, d)).toUpperCase();
}

/** "Thursday, 17 September" — the masthead dateline, in the viewer's time zone. */
export function dateline(now: Date = new Date(), timeZone: string = viewerZone()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(now);
}

/** Minutes that `timeZone` is ahead of UTC at instant `d`. */
function offsetMinutes(d: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** The UTC instant at which New York's wall clock reads hh:mm on `day`, a "YYYY-MM-DD" date. */
export function newYorkTime(day: string, hour: number, minute: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  return new Date(guess.getTime() - offsetMinutes(guess, NEW_YORK) * 60000);
}

/** The UTC instant at which New York's wall clock reads hh:mm on New York's current date. */
function newYorkTimeToday(now: Date, hour: number, minute: number): Date {
  return newYorkTime(dayKey(now, NEW_YORK), hour, minute);
}

/** True during the US regular session: Monday–Friday, 9:30 AM–4:00 PM New York. Holidays are not modelled. */
export function usMarketOpen(now: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: NEW_YORK, weekday: "short" }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return newYorkTimeToday(now, 9, 30) <= now && now < newYorkTimeToday(now, 16, 0);
}

/** US regular session (9:30 AM – 4:00 PM New York) shown in the viewer's time zone. */
export function marketHours(now: Date = new Date(), timeZone: string = viewerZone()): { open: string; close: string } {
  return {
    open: clock(newYorkTimeToday(now, 9, 30), timeZone),
    close: clock(newYorkTimeToday(now, 16, 0), timeZone),
  };
}
