import { describe, expect, it } from "vitest";
import { SHARED_EXPORT_LABELS } from "./export-labels";
import { allPrintTargets } from "./print-sizes";
import { allWallpaperTargets } from "./wallpaper-devices";
import { timelineMessages } from "./product-modules/love-story-timeline/messages";
import { songPosterMessages } from "./product-modules/song-poster/messages";

/**
 * The shared print and wallpaper labels (19 Oct 2026). Song Poster used the
 * same targets as Love Story Timeline but had no labels, so its Studio listed
 * the raw keys (`exports.print.a4.frameless`).
 */
const TARGET_LABEL_KEYS = [
  ...allPrintTargets().map(({ size, mounting }) => `exports.print.${size.id}.${mounting}`),
  ...allWallpaperTargets().map(({ device }) => `exports.${device.labelKey}`),
].sort();

const LOCALES = ["en", "fr", "ar"] as const;

describe("the shared export labels", () => {
  it.each(LOCALES)("label every shared print and wallpaper target, and nothing else, in %s", (locale) => {
    expect(Object.keys(SHARED_EXPORT_LABELS[locale]).sort()).toEqual(TARGET_LABEL_KEYS);
  });

  it.each(LOCALES)("are each locale's own wording in %s, never another locale's", (locale) => {
    for (const other of LOCALES.filter((l) => l !== locale)) {
      for (const key of TARGET_LABEL_KEYS) {
        expect(SHARED_EXPORT_LABELS[locale][key], `${locale} ${key}`).not.toBe(SHARED_EXPORT_LABELS[other][key]);
      }
    }
  });

  it.each([
    ["love-story-timeline", timelineMessages],
    ["song-poster", songPosterMessages],
  ] as const)("are what %s shows, in every locale", (_, messages) => {
    for (const locale of LOCALES) {
      for (const key of TARGET_LABEL_KEYS) {
        expect(messages[locale]?.[key], `${locale} ${key}`).toBe(SHARED_EXPORT_LABELS[locale][key]);
      }
    }
  });
});
