import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AwardTheme } from "./award-theme";

describe("AwardTheme", () => {
  it("renders track and artist as typed", () => {
    render(<AwardTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    // Artist appears in the info column AND in the plaque's foot line.
    expect(screen.getAllByText(/The Landing/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders with no dedication and no photo, without throwing", () => {
    render(<AwardTheme track="T" artist="A" />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("shows the plaque dedication only when provided", () => {
    const { rerender } = render(<AwardTheme track="T" artist="A" />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<AwardTheme track="T" artist="A" dedication="For you." />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("does not render any transport control or waveform", () => {
    const { container } = render(<AwardTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});
