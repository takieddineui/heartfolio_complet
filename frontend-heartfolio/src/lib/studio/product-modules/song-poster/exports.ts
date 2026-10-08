import type { ExportEngineConfig, ExportFormat, ThemeSelections } from "@/types/studio";
import { allPrintTargets, dimensionsFor, type PrintOrientation } from "@/lib/studio/print-sizes";
import { allWallpaperTargets } from "@/lib/studio/wallpaper-devices";
import { DEFAULT_SONG_POSTER_THEME, getSongPosterTheme } from "./theme-registry";

/**
 * ---------------------------------------------------------------------
 * DELIVERABLES — Heartfolio's own sizes, not the prototype's
 * ---------------------------------------------------------------------
 * The prototype authored its own ratio system (4:5, 1:√2/A-series,
 * 9:19.5 phone, 3:2 landscape) and its own print-size list. NONE of
 * that is used here — this reuses the exact same `allPrintTargets()` /
 * `allWallpaperTargets()` calls `love-story-timeline/exports.ts` uses,
 * so Song Poster's print sizes, mountings and wallpaper devices are
 * identical to every other product's, by construction rather than by
 * separately maintained agreement.
 *
 * `targets` IS A FUNCTION OF THE SELECTED THEME, not a static list —
 * this is the fix for a real, previously-open gap: Award and Sleeve
 * are landscape-only (`theme-registry.ts`'s own `canvas` field says
 * so), and `render_png` on the backend already swaps a print target's
 * pixel dimensions to landscape for them, but this file used to report
 * portrait numbers regardless of which theme was selected — correct
 * for six of the eight themes, silently wrong for two.
 *
 * `ExportEngineConfig.targets` accepting a function (see
 * `types/studio.ts`'s own note on `resolveExportTargets`) is what
 * makes this possible without scaling every other product module's
 * static config into something they don't need — Love Story Timeline
 * and Where We Met Map still provide a plain `Record`, unchanged.
 *
 * ORIENTATION COMES FROM THE THEME'S OWN CANVAS SHAPE, not a second
 * flag to keep in sync with it — `theme.canvas.width > theme.canvas.
 * height` already says everything needed, the same principle
 * `png_renderer.py`'s own orientation check uses on the backend.
 */

function orientationFor(theme: ReturnType<typeof getSongPosterTheme>): PrintOrientation {
  return theme.canvas.width > theme.canvas.height ? "landscape" : "portrait";
}

function printTargetsFor(orientation: PrintOrientation): ExportFormat[] {
  return allPrintTargets().map(({ id, size, mounting }) => {
    const { width, height } = dimensionsFor(size, orientation);
    return {
      id,
      label: `exports.print.${size.id}.${mounting}`,
      mimeType: "image/png",
      width,
      height,
      isPremium: true,
    };
  });
}

const wallpaperTargets: ExportFormat[] = allWallpaperTargets().map(({ id, device }) => ({
  id,
  label: `exports.${device.labelKey}`,
  mimeType: "image/png",
  width: device.width,
  height: device.height,
}));
// Device shape doesn't depend on theme orientation — `_draw_wallpaper`
// composes full-bleed against the DEVICE's own dimensions regardless of
// which theme drew the poster, so wallpaper targets stay a plain,
// theme-independent list, unlike the print targets above.

export const songPosterExports: ExportEngineConfig = {
  targets: (themeSelections: ThemeSelections) => {
    const theme = getSongPosterTheme(themeSelections.theme as string | undefined);
    return {
      default: [...printTargetsFor(orientationFor(theme)), ...wallpaperTargets],
    };
  },
};

/** What a newly composed pack may include. Target IDS themselves do
 *  NOT vary by orientation (`printTargetId(sizeId, mounting)` has no
 *  orientation component — only the DISPLAYED/rendered dimensions for
 *  a given id differ by theme), so this can resolve against any one
 *  theme's list; the default theme's is used for no reason beyond it
 *  being a stable, always-available choice. */
export const CURRENT_EXPORT_TARGET_IDS: string[] = [
  ...printTargetsFor(orientationFor(getSongPosterTheme(DEFAULT_SONG_POSTER_THEME))).map((target) => target.id),
  ...wallpaperTargets.map((target) => target.id),
];
