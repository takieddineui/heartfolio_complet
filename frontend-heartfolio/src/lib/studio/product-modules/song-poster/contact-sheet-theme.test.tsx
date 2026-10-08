import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContactSheetTheme } from "./contact-sheet-theme";

describe("ContactSheetTheme", () => {
  it("renders track and artist as typed", () => {
    render(<ContactSheetTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    expect(screen.getAllByText("The Landing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders exactly four numbered frames, all showing the SAME photo", () => {
    const { container } = render(
      <ContactSheetTheme track="T" artist="A" photoUrl="https://example.com/p.jpg" />
    );
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(4);
    // The honest adaptation this test exists to guard: every frame is
    // the same source, never four different photos this product does
    // not collect.
    images.forEach((img) => expect(img.getAttribute("src")).toBe("https://example.com/p.jpg"));

    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("04")).toBeInTheDocument();
  });

  it("renders four empty frames when there is no photo yet, without throwing", () => {
    const { container } = render(<ContactSheetTheme track="T" artist="A" />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("04")).toBeInTheDocument();
  });

  it("shows the dedication only when provided", () => {
    const { rerender } = render(<ContactSheetTheme track="T" artist="A" />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<ContactSheetTheme track="T" artist="A" dedication="For you." />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("does not render any transport control", () => {
    render(<ContactSheetTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
