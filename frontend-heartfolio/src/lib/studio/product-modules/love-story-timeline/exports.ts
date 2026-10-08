import type { ExportFormat } from "@/types/studio";
import { allPrintTargets, dimensionsFor } from "@/lib/studio/print-sizes";
import { allWallpaperTargets } from "@/lib/studio/wallpaper-devices";

/**
 * ---------------------------------------------------------------------
 * DELIVERABLES (§2, §3)
 * ---------------------------------------------------------------------
 * Three print sizes, each in both mounting variants — six static files,
 * generated from the shared size list rather than hand-listed, so adding a
 * size cannot leave the frameless/edged pair half-built.
 *
 * DIMENSIONS ARE PORTRAIT HERE, and that is a temporary truth rather than an
 * assumption. `ExportEngineConfig.targets` is keyed by *canvas*, not by
 * orientation, so a static config has nowhere to express "this size, the
 * other way up". Every current layout is portrait (see `print-sizes.ts`), so
 * portrait dimensions are correct for everything that exists today. When a
 * landscape layout is designed, the export engine will need to call
 * `dimensionsFor(size, orientationFor(layout))` at render time instead of
 * reading these numbers directly — the helper already exists and is used
 * below, so that change is localized to the engine.
 *
 * LEGACY TARGETS ARE RETAINED. `print-png` and the four social/wallpaper
 * shapes predate this model and are no longer offered in any pack, but
 * entitlements from orders already placed still name them. The export
 * registry is what turns a target id back into pixels at download time, so
 * removing these would break re-downloads of past purchases. They are marked
 * below and excluded from new packs, not deleted.
 */

const printTargets: ExportFormat[] = allPrintTargets().map(({ id, size, mounting }) => {
  // Portrait for every layout that currently exists.
  const { width, height } = dimensionsFor(size, "portrait");
  return {
    id,
    label: `exports.print.${size.id}.${mounting}`,
    mimeType: "image/png",
    width,
    height,
    isPremium: true,
  };
});

/**
 * §4 — one dedicated render per device, not scaled copies of the print
 * designs. The safe zones that make them different live in
 * `wallpaper-devices.ts`; the renderer applies them.
 */
const wallpaperTargets: ExportFormat[] = allWallpaperTargets().map(({ id, device }) => ({
  id,
  label: `exports.${device.labelKey}`,
  mimeType: "image/png",
  width: device.width,
  height: device.height,
}));

/** Superseded by the §2 sizing model; kept resolvable for existing orders. */
const legacyTargets: ExportFormat[] = [
  { id: "story-png", label: "exports.legacy.story", mimeType: "image/png", width: 1080, height: 1920 },
  { id: "square-png", label: "exports.legacy.square", mimeType: "image/png", width: 1080, height: 1080 },
  { id: "landscape-png", label: "exports.legacy.landscape", mimeType: "image/png", width: 1920, height: 1080 },
  { id: "portrait-png", label: "exports.legacy.portrait", mimeType: "image/png", width: 1080, height: 1350 },
  { id: "print-png", label: "exports.legacy.print", mimeType: "image/png", width: 2480, height: 3508, isPremium: true },
];

// No explicit `: ExportEngineConfig` annotation — `targets` here is
// only ever the plain `Record` half of that interface's now-widened
// `targets` type (see `types/studio.ts`'s note on `resolveExportTargets`,
// added for Song Poster's Award/Sleeve). Annotating this constant with
// the wider interface type would force every direct read of
// `timelineExports.targets.default` (this file's own test does exactly
// that) to first prove the function branch isn't the one present.
// Leaving the type inferred keeps it concrete here; it is still
// structurally assignable to `ExportEngineConfig` wherever the Shell
// consumes it generically (`ProductModuleConfig.delivery.export`).
export const timelineExports = {
  targets: {
    default: [...printTargets, ...wallpaperTargets, ...legacyTargets],
  },
};

/** What a newly composed pack may include — legacy ids deliberately absent. */
export const CURRENT_EXPORT_TARGET_IDS: string[] = [
  ...printTargets.map((target) => target.id),
  ...wallpaperTargets.map((target) => target.id),
];
