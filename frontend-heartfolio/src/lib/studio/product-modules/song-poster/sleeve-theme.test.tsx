import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SleeveTheme, SLEEVE_PALETTES, DEFAULT_SLEEVE_PALETTE, getSleevePalette } from "./sleeve-theme";

describe("SleeveTheme", () => {
  it("renders track and artist as typed", () => {
    render(<SleeveTheme track="Halfway Home" artist="The Landing" />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    expect(screen.getAllByText("The Landing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders two discs, each with four curved-text rings", () => {
    const { container } = render(<SleeveTheme track="T" artist="A" dedication="For you." />);
    const paths = container.querySelectorAll("path[id]");
    // 4 rings per disc, 2 discs = 8 ring paths total.
    expect(paths).toHaveLength(8);
  });

  it("renders with no dedication, falling back to the dot texture rather than throwing", () => {
    const { container } = render(<SleeveTheme track="T" artist="A" />);
    const textPaths = container.querySelectorAll("textPath");
    expect(textPaths.length).toBeGreaterThan(0);
    textPaths.forEach((tp) => expect(tp.textContent).toMatch(/^(· )+/));
  });

  it("does not render any transport control", () => {
    render(<SleeveTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("defaults to Cream when no palette is specified", () => {
    const { container } = render(<SleeveTheme track="T" artist="A" />);
    const sheet = container.querySelector('[data-testid="sleeve-theme"]') as HTMLElement;
    const cream = getSleevePalette(DEFAULT_SLEEVE_PALETTE);
    expect(sheet.style.getPropertyValue("--sv-bg")).toBe(cream.bg);
    expect(sheet.style.getPropertyValue("--sv-ink")).toBe(cream.ink);
  });

  it("applies every one of the six real palettes, not just Cream", () => {
    for (const palette of SLEEVE_PALETTES) {
      const { container, unmount } = render(<SleeveTheme track="T" artist="A" sleevePaletteId={palette.id} />);
      const sheet = container.querySelector('[data-testid="sleeve-theme"]') as HTMLElement;
      expect(sheet.style.getPropertyValue("--sv-bg")).toBe(palette.bg);
      expect(sheet.style.getPropertyValue("--sv-ink")).toBe(palette.ink);
      expect(sheet.style.getPropertyValue("--sv-soft")).toBe(palette.soft);
      unmount();
    }
  });

  it("falls back to Cream for an unrecognised palette id, rather than rendering with nothing set", () => {
    const { container } = render(<SleeveTheme track="T" artist="A" sleevePaletteId="not-a-real-palette" />);
    const sheet = container.querySelector('[data-testid="sleeve-theme"]') as HTMLElement;
    const cream = getSleevePalette(DEFAULT_SLEEVE_PALETTE);
    expect(sheet.style.getPropertyValue("--sv-bg")).toBe(cream.bg);
  });

  it("the three accent swatches stay fixed regardless of the ground palette", () => {
    // The prototype's own --swatch1/2/3 never changed when the palette
    // picker swapped --bg/--ink — proving that stays true here too.
    const { container: creamContainer } = render(<SleeveTheme track="T" artist="A" sleevePaletteId="cream" />);
    const { container: blackContainer } = render(<SleeveTheme track="T" artist="A" sleevePaletteId="black" />);
    const creamSwatches = Array.from(creamContainer.querySelectorAll("i")).map((el) => (el as HTMLElement).style.background);
    const blackSwatches = Array.from(blackContainer.querySelectorAll("i")).map((el) => (el as HTMLElement).style.background);
    expect(creamSwatches).toEqual(blackSwatches);
    expect(creamSwatches).toEqual(["rgb(31, 110, 107)", "rgb(198, 67, 46)", "rgb(217, 162, 51)"]);
  });
});

/**
 * Every title box has room below for an Arabic title's tails (19 Oct 2026),
 * but Sleeve's two-line title clamps a third line that is still painted, and
 * the room would show its top. jsdom lays nothing out, so the line count is
 * faked; the browser check measured the real thing (a cut title's hidden line
 * stays 5 units below the box, a two-line Arabic title keeps every dot).
 */
describe("SleeveTheme: a cut title keeps its old bottom edge", () => {
  function withLineTops(tops: number[]) {
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    }
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue(tops.map((top) => ({ top }) as DOMRect) as unknown as DOMRectList);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a title laid out on three lines or more", () => {
    withLineTops([0, 48, 96]);
    const { container } = render(<SleeveTheme track="The Long and Winding Road That Leads Me Back" artist="A" />);
    expect(container.querySelector("h1")).toHaveAttribute("data-clamped", "true");
  });

  it("leaves a title of two lines unmarked, so it keeps the room", () => {
    withLineTops([0, 0, 48]);
    const { container } = render(<SleeveTheme track="Bohemian Rhapsody" artist="A" />);
    expect(container.querySelector("h1")).not.toHaveAttribute("data-clamped");
  });
});
