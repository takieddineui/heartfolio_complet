import { describe, expect, it } from "vitest";
import { resolveExportTargets } from "@/types/studio";
import { songPosterExports } from "./exports";

/**
 * The fix for a real, previously-open gap: the Studio's export panel
 * used to report portrait dimensions for EVERY theme, including Award
 * and Sleeve — both landscape-only — even after the backend renderer
 * was fixed to deliver the correct landscape file. This proves the
 * DISPLAYED dimensions now agree with what actually gets delivered,
 * for every theme, not just the two that changed.
 */
describe("songPosterExports — theme-aware orientation", () => {
  function printDimensions(themeId: string) {
    const targets = resolveExportTargets(songPosterExports, { theme: themeId });
    const print = targets.default!.find((t) => t.id === "print-classic-frameless")!;
    return { width: print.width, height: print.height };
  }

  it("reports portrait dimensions for every portrait theme", () => {
    for (const themeId of ["player", "ledger", "ephemeris", "contactsheet", "label", "mosaic"]) {
      const { width, height } = printDimensions(themeId);
      expect(height).toBeGreaterThan(width);
    }
  });

  it("reports landscape dimensions for Award and Sleeve", () => {
    for (const themeId of ["award", "sleeve"]) {
      const { width, height } = printDimensions(themeId);
      expect(width).toBeGreaterThan(height);
    }
  });

  it("reports the SAME two numbers, swapped, for the same nominal print size", () => {
    // Matches the backend proof in tests.py's
    // `test_landscape_themes_swap_a_nominally_portrait_print_target`:
    // one physical paper size, oriented per theme, not two different
    // sizes.
    const portrait = printDimensions("player");
    const landscape = printDimensions("award");
    expect(landscape.width).toBe(portrait.height);
    expect(landscape.height).toBe(portrait.width);
  });

  it("falls back to the default theme's (portrait) orientation for an unrecognised theme id", () => {
    const { width, height } = printDimensions("not-a-real-theme");
    expect(height).toBeGreaterThan(width);
  });

  it("wallpaper targets are identical regardless of theme — device shape doesn't depend on orientation", () => {
    const playerTargets = resolveExportTargets(songPosterExports, { theme: "player" }).default!;
    const awardTargets = resolveExportTargets(songPosterExports, { theme: "award" }).default!;
    const playerWallpaper = playerTargets.find((t) => t.id === "wallpaper-phone");
    const awardWallpaper = awardTargets.find((t) => t.id === "wallpaper-phone");
    expect(awardWallpaper).toEqual(playerWallpaper);
  });
});
