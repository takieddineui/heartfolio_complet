import type { ProductModuleConfig } from "@/types/studio";
import { songPosterSchema } from "./schema";
import { createInitialState, createInitialThemeSelections, type SongPosterValues } from "./initial-state";
import { SongPosterLivePreview, SongPosterRenderer } from "./renderer-adapter";
import { songPosterPricing } from "./pricing";
import { songPosterExports } from "./exports";
import { songPosterMessages } from "./messages";
import { songPosterThemes } from "./themes";
import { validateSongPoster } from "./validation";
import { getSongPosterTheme } from "./theme-registry";

export const songPosterModule: ProductModuleConfig<SongPosterValues> = {
  formSchema: songPosterSchema,
  // The real theme axis (player/ledger/ephemeris/...), generated from
  // `theme-registry.ts` — corrects the earlier `{ axes: [] }`, which
  // claimed there was nothing to choose. There is exactly one thing to
  // choose, and it is the one that matters most: which of the eight
  // documents this becomes.
  themes: songPosterThemes,
  renderer: {
    kind: "component",
    component: SongPosterRenderer,
    // Reads the SELECTED theme's own canvas, not a hardcoded constant —
    // Player is portrait; a later landscape theme (Award, Sleeve) needs
    // a genuinely different intrinsic size, the same reason Love Story
    // Timeline's own `intrinsicSize` branches on layout orientation
    // rather than returning one fixed value.
    intrinsicSize: (_values, themeSelections) => getSongPosterTheme(themeSelections.theme as string | undefined).canvas,
  },
  pricing: songPosterPricing,
  delivery: {
    mode: "export",
    export: songPosterExports,
  },
  messages: songPosterMessages,
  createInitialState,
  createInitialThemeSelections,
  validate: validateSongPoster,
  /**
   * The SAME component as `renderer.component` above, not a second one
   * — per this field's own doc comment in `types/studio.ts`: "Takes the
   * SAME component that renders the real, purchased page... so the
   * identical component works as a live, pre-purchase Studio preview
   * with no server round-trip." Both now dispatch by theme selection
   * (`renderer-adapter.tsx`), so this stays true for whichever of the
   * eight themes is actually chosen, not only Player.
   */
  livePreview: { component: SongPosterLivePreview },
};
