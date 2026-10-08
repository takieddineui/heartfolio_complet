import type { ThemeEngineConfig } from "@/types/studio";
import { SONG_POSTER_THEMES, DEFAULT_SONG_POSTER_THEME } from "./theme-registry";
import { SLEEVE_PALETTES, DEFAULT_SLEEVE_PALETTE } from "./sleeve-theme";

/**
 * `kind: "select"`, structural — read directly from `themeSelections.
 * theme` by `renderer-adapter.tsx`, not merged into `tokens` the way
 * palette/typography axes are. Same category as Love Story Timeline's
 * own `layout` axis (see that file's comment on the `tokens?` field's
 * doc in `types/studio.ts`: "Structural axes ... may omit [tokens] and
 * instead be read directly from `themeSelections` by the renderer").
 *
 * Options are GENERATED from `SONG_POSTER_THEMES`, never hand-listed —
 * the exact discipline `timelineThemes`'s own `layout` axis follows,
 * and for the identical reason: a second, hand-maintained list is a
 * second place for the real theme registry to silently drift from.
 */
export const songPosterThemes: ThemeEngineConfig = {
  axes: [
    {
      id: "theme",
      label: "themes.theme.label",
      kind: "select",
      defaultOptionId: DEFAULT_SONG_POSTER_THEME,
      options: SONG_POSTER_THEMES.map((theme) => ({
        id: theme.id,
        label: theme.name,
      })),
    },
    {
      // A SECOND axis, not folded into the theme picker's own options
      // (e.g. "sleeve-cream", "sleeve-mustard" as six extra theme
      // entries) — the theme choice and the palette choice are
      // orthogonal, and collapsing them would mean switching AWAY
      // from Sleeve and back loses whichever palette was picked,
      // which the prototype's own design never did either.
      id: "sleevePalette",
      label: "themes.sleevePalette.label",
      kind: "swatch",
      defaultOptionId: DEFAULT_SLEEVE_PALETTE,
      // Only rendered when Sleeve is the selected theme — the other
      // seven themes have no palette to pick, and showing a picker
      // with nothing for it to affect would be worse than not
      // offering it. `"theme.theme"` because `visibleWhen` evaluates
      // against `{ values, theme: themeSelections }` (confirmed
      // against `theme-picker.tsx`'s own `visibilityContext`), and
      // this module's own theme axis is itself named "theme".
      visibleWhen: [{ path: "theme.theme", op: "eq", value: "sleeve" }],
      options: SLEEVE_PALETTES.map((palette) => ({
        id: palette.id,
        label: palette.name,
        swatch: palette.bg,
      })),
    },
  ],
};
