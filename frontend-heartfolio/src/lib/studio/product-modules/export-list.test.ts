import { describe, expect, it } from "vitest";
import { resolveExportTargets } from "@/types/studio";
import { loveStoryTimelineModule } from "./love-story-timeline";
import { songPosterModule } from "./song-poster";

/**
 * THE STUDIO SIDEBAR HAS NO SIZE LIST (19 Oct 2026). Love Story Timeline opts
 * out of `ExportSection`'s customer-facing list of raw print and wallpaper
 * sizes (§15, `hideCustomerFacingList`); Song Poster never did, so its sidebar
 * had an extra "Export" panel listing every size, wallpapers it no longer sells
 * included. Both now opt out in their own config; the shared shell and section
 * stay product-agnostic. `targets` stays populated in both.
 */
describe.each([
  ["love-story-timeline", loveStoryTimelineModule],
  ["song-poster", songPosterModule],
] as const)("%s", (_, module) => {
  it("keeps the export targets but hides their list from the sidebar", () => {
    const { delivery } = module;
    expect(delivery.mode).toBe("export");
    if (delivery.mode !== "export") return;
    expect(delivery.export.hideCustomerFacingList).toBe(true);
    const formats = Object.values(resolveExportTargets(delivery.export, module.createInitialThemeSelections())).flat();
    expect(formats.length).toBeGreaterThan(0);
  });
});
