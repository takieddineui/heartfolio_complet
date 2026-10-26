import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MomentWallpaper } from "./preview-modes";

/** The moment wallpaper's date in the preview is the one the delivered
 *  wallpaper prints: the order's language, not always "Apr 12, 2019"
 *  (both sides were English-only until 26 Oct 2026). */
describe("MomentWallpaper", () => {
  it.each([
    ["en", "Apr 12, 2019"],
    ["fr", "12 avr. 2019"],
    ["ar", "12 أبريل 2019"],
  ])("%s: %s", (locale, expected) => {
    render(<MomentWallpaper photoUrl={undefined} title="We met" date="2019-04-12" locale={locale} safeBottom={0.1} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
