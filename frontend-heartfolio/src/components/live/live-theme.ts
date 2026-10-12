import type { CSSProperties } from "react";
import { themeEngine } from "@/lib/studio/theme-engine";
import { timelineThemes } from "@/lib/studio/product-modules/love-story-timeline/themes";

/**
 * The live keepsake's colours and fonts, from the SAME tokens the Studio
 * preview uses.
 *
 * WHY THIS EXISTS. The page used to carry its own palette table in
 * `live-keepsake.module.css`, and it styled four of the eight palettes
 * (blush, midnight, sage, monochrome). Terracotta, Gilded and Forest Night
 * silently fell back to the classic cream, so a customer who chose Forest
 * Night for a dark green keepsake gave their recipient a cream page. The
 * typography axis was ignored entirely: all four options rendered in Georgia.
 *
 * A second hand-maintained list was the cause, so there is no second list
 * here. `timelineThemes` (themes.ts) is the one place palettes and type
 * stacks are defined; `compositions.py`'s print palettes mirror it and a test
 * pins that. Adding a palette there now reaches this page with no CSS change.
 *
 * WHAT MAPS TO WHAT. The page's own variables keep their names (`--paper`,
 * `--ink`, `--muted`, `--accent`), because the opening sequence, the ending
 * and the music toggle already read them:
 *
 *   --p-bg -> --paper     --p-text -> --ink
 *   --p-muted -> --muted  --p-accent -> --accent
 *   --poster-heading-font -> --live-heading-font   (the big display text:
 *       the title and each milestone's title)
 *   --poster-body-font    -> --live-body-font      (everything else)
 *
 * FONTS ARE THE PREVIEW'S, NOT BETTER THAN THE PREVIEW'S. The font tokens name
 * "Fraunces", "Inter" and "JetBrains Mono", and none of those is a loaded
 * `@font-face` family (the site loads "Heartfolio Serif" and "Heartfolio
 * Sans"), so in the Studio preview and here the browser uses each stack's
 * fallback (Georgia, the system sans, a cursive face, monospace). That is a
 * known issue with the tokens themselves, recorded rather than patched here:
 * changing them changes the Studio preview's text metrics, which the
 * milestone fit was tuned against. This page shows what the preview shows.
 *
 * An id that is not a real option (a hand-edited or stale project) gets the
 * axis's DEFAULT, never "no token", so the page can never lose its colours.
 */
const RENAMES: Record<string, string> = {
  "--p-bg": "--paper",
  "--p-text": "--ink",
  "--p-muted": "--muted",
  "--p-accent": "--accent",
  "--poster-heading-font": "--live-heading-font",
  "--poster-body-font": "--live-body-font",
};

/** The Arabic-only Kufi alias declared in `live-keepsake.module.css`. */
const ARABIC_HEADING_FACE = '"Heartfolio Live Arabic"';
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "cursive", "monospace", "fantasy", "system-ui"]);

/**
 * Puts `face` just BEFORE a stack's closing generic family. A generic family
 * (`serif`, `cursive`, `monospace`) is a catch-all that would claim Arabic
 * characters first, so the Arabic face has to come ahead of it; it covers
 * Arabic only, so Latin text still resolves to the stack's own faces.
 */
export function withArabicFace(stack: string, face: string): string {
  const families = stack.split(",").map((family) => family.trim());
  const last = families[families.length - 1]!;
  if (GENERIC_FAMILIES.has(last)) families.splice(families.length - 1, 0, face);
  else families.push(face);
  return families.join(", ");
}

export function liveThemeStyle(themeSelections: Record<string, string | number> | undefined): CSSProperties {
  const selections: Record<string, string | number> = { ...(themeSelections ?? {}) };

  // Drop a selection that names no real option, so the engine falls back to
  // the axis default instead of resolving to nothing.
  for (const axis of timelineThemes.axes) {
    if (axis.kind === "range") continue;
    if (!axis.options.some((option) => option.id === selections[axis.id])) delete selections[axis.id];
  }

  const resolved = themeEngine.resolveTokens(timelineThemes, selections);
  const style: Record<string, string> = {};
  for (const [token, name] of Object.entries(RENAMES)) {
    const value = resolved[token];
    if (!value) continue;
    // Only the display text gets the Arabic face: it is what the page's
    // headings used (via the site's heading font) before this took over.
    style[name] = name === "--live-heading-font" ? withArabicFace(value, ARABIC_HEADING_FACE) : value;
  }
  return style as CSSProperties;
}
