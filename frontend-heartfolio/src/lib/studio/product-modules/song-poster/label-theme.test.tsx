import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabelTheme } from "./label-theme";

describe("LabelTheme", () => {
  it("renders track and artist as typed", () => {
    render(<LabelTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    expect(screen.getAllByText("The Landing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders with no dedication and no photo, without throwing", () => {
    render(<LabelTheme track="T" artist="A" />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("shows the dedication only when provided", () => {
    const { rerender } = render(<LabelTheme track="T" artist="A" />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<LabelTheme track="T" artist="A" dedication="For you." />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("does not render any transport control or waveform", () => {
    const { container } = render(<LabelTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Only one <svg> — the disc's grooves — no separate waveform graphic.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});
