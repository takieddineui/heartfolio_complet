import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EphemerisTheme } from "./ephemeris-theme";

describe("EphemerisTheme", () => {
  it("renders track and artist as typed", () => {
    render(<EphemerisTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    // Artist appears twice — the small-caps byline under the title, and
    // again in the footer, same pattern as Ledger's.
    expect(screen.getAllByText("The Landing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders with no dedication and no photo, without throwing", () => {
    render(<EphemerisTheme track="T" artist="A" />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("shows the dedication only when provided", () => {
    const { rerender } = render(<EphemerisTheme track="T" artist="A" />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<EphemerisTheme track="T" artist="A" dedication="For you." />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("does not render any transport control — no field exists to drive one", () => {
    render(<EphemerisTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws no tick marks or moment marker — this product has no duration or moment field", () => {
    const { container } = render(<EphemerisTheme track="T" artist="A" />);
    // The prototype's tick marks each carry a `data-tick` attribute;
    // the moment hand is an `.ep-hand`-equivalent group. Neither
    // concept exists in this adaptation — asserting their absence is
    // what keeps this test file catching a REGRESSION (someone adding
    // fabricated ticks/a fake moment later) rather than only testing
    // what already renders.
    expect(container.querySelector("[data-tick]")).toBeNull();
  });
});
