import { describe, expect, it } from "vitest";
import { timelineThemes } from "./themes";
import { timelineMessages } from "./messages";
import { resolveModuleText } from "@/lib/studio/i18n";

/**
 * THE APPEARANCE CONTROLS ARE TRANSLATED, NOT AN ENGLISH ISLAND.
 *
 * French and Arabic once had NO labels for the Appearance section's controls
 * (typography, the eight palette names, the text-scale heading), so a localized
 * Studio showed English there and nothing said so: a missing key falls back to
 * English by design (`resolveModuleText`), which makes the gap invisible and
 * would let this test pass if it asked the fallback. It reads each locale's OWN
 * dictionary instead, for the heading of every axis and every option the axis
 * offers, so a new palette or option added in English only fails here.
 *
 * Story Style's option names come from the layouts' own keys and are covered by
 * their own entries; its heading is included below.
 */
const axes = timelineThemes.axes;
const keysOf = (axis: (typeof axes)[number]) => [axis.label, ...("options" in axis ? axis.options.map((option) => option.label) : [])];
/**
 * Words that are correctly the same in French as in English. They still need
 * their OWN entry (the test below checks it exists); they are only exempt from
 * "differs from the English". Arabic has none: nothing here is a cognate there.
 */
const SAME_WORD_IN: Record<string, string[]> = {
  fr: ["themes.palette.label", "themes.palette.options.terracotta", "themes.palette.options.monochrome"],
};
const NAMED = axes.filter((axis) => ["palette", "typography", "scale"].includes(axis.id));

describe("the Appearance axes", () => {
  it("are the ones this test expects (a new axis must be added here or consciously left out)", () => {
    expect(axes.map((axis) => axis.id)).toEqual(["palette", "typography", "layout", "scale"]);
  });

  it("include every one of the eight palettes and four typefaces", () => {
    const palette = axes.find((axis) => axis.id === "palette")!;
    const typography = axes.find((axis) => axis.id === "typography")!;
    expect("options" in palette && palette.options.length).toBe(8);
    expect("options" in typography && typography.options.length).toBe(4);
  });
});

describe.each(["fr", "ar"] as const)("%s", (locale) => {
  const own = timelineMessages[locale]!;
  const english = timelineMessages.en!;

  it.each(NAMED.map((axis) => [axis.id, axis] as const))("has its own entry, different from the English, for every %s label", (_id, axis) => {
    for (const key of keysOf(axis)) {
      expect(own[key], `${locale} is missing ${key}`).toBeTruthy();
      if (!SAME_WORD_IN[locale]?.includes(key)) expect(own[key], `${locale} ${key} is just the English`).not.toBe(english[key]);
    }
  });

  it("lists as 'the same word' only labels that really are the same word", () => {
    // The allowlist is a record of true cognates, not an escape hatch: a label
    // left in English would otherwise hide in it.
    for (const key of SAME_WORD_IN[locale] ?? []) expect(own[key], `${locale} ${key} is not the English word`).toBe(english[key]);
  });

  it("has its own heading for Story Style", () => {
    const layout = axes.find((axis) => axis.id === "layout")!;
    expect(own[layout.label], `${locale} is missing ${layout.label}`).toBeTruthy();
  });

  it("names the eight palettes with eight different names", () => {
    const palette = axes.find((axis) => axis.id === "palette")!;
    const names = keysOf(palette).slice(1).map((key) => resolveModuleText(key, locale, timelineMessages));
    expect(new Set(names).size).toBe(8);
  });

  it("names a palette the way the site's own copy does where it already had a name", () => {
    // The marketing pages already call these "Midnight" and "Warm Ivory"; the
    // Studio's names must not contradict them.
    const names = Object.fromEntries(keysOf(axes.find((axis) => axis.id === "palette")!).slice(1).map((key) => [key, own[key]]));
    const expected = locale === "fr" ? { midnight: "Minuit", classic: "Ivoire classique" } : { midnight: "منتصف الليل", classic: "عاجي كلاسيكي" };
    expect(names["themes.palette.options.midnight"]).toBe(expected.midnight);
    expect(names["themes.palette.options.classic"]).toBe(expected.classic);
  });
});
