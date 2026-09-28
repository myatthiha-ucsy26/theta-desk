import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, dismissToast, toast, useToasts } from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("toast", () => {
  it("shows a message and clears it on its own", () => {
    const { result } = renderHook(() => useToasts());
    act(() => toast("Settings saved"));
    expect(result.current.map((t) => [t.message, t.tone])).toEqual([["Settings saved", "good"]]);
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(result.current).toEqual([]);
  });

  it("can be dismissed early", () => {
    const { result } = renderHook(() => useToasts());
    act(() => toast("Could not save", "critical"));
    act(() => dismissToast(result.current[0].id));
    expect(result.current).toEqual([]);
  });
});
