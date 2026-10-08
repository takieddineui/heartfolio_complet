import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LedgerTheme } from "./ledger-theme";

describe("LedgerTheme", () => {
  it("renders track and artist as typed", () => {
    render(<LedgerTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    // Artist appears twice — the byline under the title, and again in
    // the footer, matching the prototype's own `.lg-foot` — so this
    // asserts there are at least two, not exactly one.
    expect(screen.getAllByText("The Landing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders with no dedication and no photo, without throwing", () => {
    render(<LedgerTheme track="T" artist="A" />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("shows the dedication only when provided", () => {
    const { rerender } = render(<LedgerTheme track="T" artist="A" />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<LedgerTheme track="T" artist="A" dedication="For you." />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("does not render any transport control — this theme has none, by design", () => {
    render(<LedgerTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
