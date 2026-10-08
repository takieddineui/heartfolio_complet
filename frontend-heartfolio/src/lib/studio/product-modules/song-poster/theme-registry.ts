import type { ComponentType } from "react";
import { PlayerTheme, type PlayerThemeProps } from "./player-theme";
import { LedgerTheme } from "./ledger-theme";
import { EphemerisTheme } from "./ephemeris-theme";
import { ContactSheetTheme } from "./contact-sheet-theme";
import { LabelTheme } from "./label-theme";
import { AwardTheme } from "./award-theme";
import { SleeveTheme } from "./sleeve-theme";
import { MosaicTheme } from "./mosaic-theme";

/**
 * ---------------------------------------------------------------------
 * THE THEME AXIS — a customer choice, not an implementation detail
 * ---------------------------------------------------------------------
 * A real correction, not the original design: the first version of this
 * module hardcoded `PlayerTheme` directly into `renderer-adapter.tsx`,
 * as if Player WERE the product. It is one of eight — "each theme is a
 * distinct object," per the prototype's own description, not a shared
 * layout with swapped colours — and a customer is meant to pick among
 * them the same way a Love Story Timeline customer picks a `layout`.
 * Building a second theme without first fixing this would have meant
 * two themes with no way to actually switch between them.
 *
 * MIRRORS `TIMELINE_LAYOUTS`'S OWN SHAPE deliberately: a real registry
 * array, `themes.ts`'s axis options generated FROM it
 * (`SONG_POSTER_THEMES.map(...)`) rather than a hand-maintained second
 * list. That LST file's own comment explains exactly why — a
 * hand-duplicated option list silently drifts from the real renderer
 * registry, which is what "layouts are broken and can ruin the poster
 * composition" turned out to be.
 *
 * EACH THEME IS ITS OWN COMPONENT, not a CSS class switched within one
 * shared renderer the way LST's `LAYOUT_CLASS` works — because these
 * are not six variations on one composition, they are eight genuinely
 * different documents (a session-log, an astronomical dial, a record
 * label...). `component` is `ComponentType<PlayerThemeProps>` for every
 * entry: every theme takes the same song/artist/photo/YouTube props,
 * because the DATA is shared across all eight (see `schema.ts`) — only
 * the visual treatment differs, which is exactly what a theme axis is
 * for.
 */
export interface SongPosterThemeDefinition {
  id: string;
  /** Translation key. */
  name: string;
  component: ComponentType<PlayerThemeProps>;
  /** The authored design canvas THIS theme's CSS module is tuned
   *  against — not assumed shared across themes. Player is portrait
   *  (800x1000); Award and Sleeve are landscape-only in the prototype
   *  (§ the theme/ratio matrix worked out when Player was scoped), so a
   *  single hardcoded canvas constant would silently be wrong the
   *  moment either is added. */
  canvas: { width: number; height: number };
}

export const SONG_POSTER_THEMES: SongPosterThemeDefinition[] = [
  {
    id: "player",
    name: "themes.theme.options.player",
    component: PlayerTheme,
    canvas: { width: 800, height: 1000 },
  },
  {
    id: "ledger",
    name: "themes.theme.options.ledger",
    component: LedgerTheme,
    canvas: { width: 800, height: 1000 },
  },
  {
    id: "ephemeris",
    name: "themes.theme.options.ephemeris",
    component: EphemerisTheme,
    canvas: { width: 800, height: 1000 },
  },
  {
    id: "contactsheet",
    name: "themes.theme.options.contactsheet",
    component: ContactSheetTheme,
    canvas: { width: 800, height: 1000 },
  },
  {
    id: "label",
    name: "themes.theme.options.label",
    component: LabelTheme,
    canvas: { width: 800, height: 1000 },
  },
  {
    id: "award",
    name: "themes.theme.options.award",
    component: AwardTheme,
    // LANDSCAPE — 1200x800 (3:2), the prototype's own `landscape`
    // ratio. The first entry in this registry whose canvas is not
    // 800x1000; see `award-theme.tsx`'s own docstring for why.
    canvas: { width: 1200, height: 800 },
  },
  {
    id: "sleeve",
    name: "themes.theme.options.sleeve",
    component: SleeveTheme,
    canvas: { width: 1200, height: 800 },
  },
  {
    id: "mosaic",
    name: "themes.theme.options.mosaic",
    component: MosaicTheme,
    canvas: { width: 800, height: 1000 },
  },
  // All eight of the prototype's themes are now registered.
];

export const DEFAULT_SONG_POSTER_THEME = "player";

export function getSongPosterTheme(id: string | undefined): SongPosterThemeDefinition {
  return SONG_POSTER_THEMES.find((theme) => theme.id === id) ?? SONG_POSTER_THEMES[0]!;
}
