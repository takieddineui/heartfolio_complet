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
 * FONTS ARE THE PREVIEW'S, AND THEY ARE REAL. The tokens name "Heartfolio
 * Serif" (Fraunces), "Heartfolio Sans" (Inter) and "JetBrains Mono", all
 * registered `@font-face` families (globals.css), so this page and the Studio
 * preview draw the same faces on every device. They used to name fonts that
 * were never loaded and fell back to whatever the browser had;
 * `typography-fonts.test.ts` now fails if a token names an unregistered
 * family. "Romantic Script" is slanted Fraunces: the print draws DejaVu Serif
 * Italic for it, and `--live-heading-style` carries the slant.
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
  "--poster-heading-style": "--live-heading-style",
};

/** The Arabic-only Kufi alias declared in `live-keepsake.module.css`. */
const ARABIC_HEADING_FACE = '"Heartfolio Live Arabic"';

/**
 * Puts the Arabic face FIRST in a stack. It covers Arabic characters only, so
 * Latin text still resolves to the stack's own faces; it has to lead because
 * the stacks' own families can carry Arabic too ("Heartfolio Sans" brings
 * Naskh, a reading face, which would otherwise win for a heading) and a
 * closing generic family (`serif`, `monospace`) claims whatever is left.
 * Headings are Kufi on /ar everywhere on this site (globals.css, §24).
 */
export function withArabicFace(stack: string, face: string): string {
  return `${face}, ${stack}`;
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
