// Parsing for the signal and backtest event streams. Pure: no EventSource here.
export const UNREADABLE = "The server sent an unreadable update.";

export type StreamEvent =
  | { kind: "log"; step: string; msg: string }
  | { kind: "result"; data: unknown }
  | { kind: "abort"; msg: string }
  | { kind: "ignore" };

const unreadable: StreamEvent = { kind: "abort", msg: UNREADABLE };

// The server sends `data: {"data": ...}` for a result, so unwrap one level here and let
// each screen say what it expected.
export function parseStreamEvent(type: string, rawData: string): StreamEvent {
  if (type !== "log" && type !== "result" && type !== "abort") return { kind: "ignore" };

  let body: unknown;
  try {
    body = JSON.parse(rawData);
  } catch {
    return unreadable;
  }
  if (typeof body !== "object" || body === null) return unreadable;

  const payload = body as Record<string, unknown>;
  if (type === "log") {
    if (typeof payload.msg !== "string") return unreadable;
    return { kind: "log", step: typeof payload.step === "string" ? payload.step : "", msg: payload.msg };
  }
  if (type === "abort") {
    return typeof payload.msg === "string" ? { kind: "abort", msg: payload.msg } : unreadable;
  }
  return "data" in payload ? { kind: "result", data: payload.data } : unreadable;
}