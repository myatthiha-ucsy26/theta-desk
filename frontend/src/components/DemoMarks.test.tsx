import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoBadge, DemoWatermark } from "./DemoMarks";

afterEach(cleanup);

describe("demo marks", () => {
  it("says, in words, that the figures are simulated", () => {
    render(<DemoBadge />);
    expect(screen.getByText("DEMO · simulated data")).toBeTruthy();
  });

  it("lays a watermark over the page that never takes a click", () => {
    const { container } = render(<DemoWatermark />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.className).toContain("demo-watermark");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  });
});
