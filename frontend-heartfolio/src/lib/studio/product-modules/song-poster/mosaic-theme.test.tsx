import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MosaicTheme } from "./mosaic-theme";

describe("MosaicTheme", () => {
  it("renders track and artist as typed", () => {
    render(<MosaicTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    expect(screen.getAllByText("The Landing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders all eight decorative marks", () => {
    const { container } = render(<MosaicTheme track="T" artist="A" />);
    // 2 hearts + 2 single notes + 1 multi-note + 1 sparkle + 1
    // headphones + 1 disc = 8 marks total.
    expect(container.querySelectorAll("i")).toHaveLength(8);
  });

  it("renders with no dedication and no photo, without throwing", () => {
    render(<MosaicTheme track="T" artist="A" />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("shows the dedication only when provided", () => {
    const { rerender } = render(<MosaicTheme track="T" artist="A" />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<MosaicTheme track="T" artist="A" dedication="For you." />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("does not render any transport control", () => {
    render(<MosaicTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
