import type { ThemeSelections } from "@/types/studio";
import { DEFAULT_SONG_POSTER_THEME } from "./theme-registry";
import { DEFAULT_SLEEVE_PALETTE } from "./sleeve-theme";

export interface SongPosterPhoto {
  url: string;
  mimeType: string;
  filename: string;
  /** Same role as `TimelinePhoto.assetId` — the durable Django/R2
   *  reference, stamped in at checkout; `url` is only ever a preview. */
  assetId?: string;
}

export interface SongPosterValues {
  track: string;
  artist: string;
  dedication: string;
  photo?: SongPosterPhoto;
  /**
   * The raw pasted text, exactly as the customer typed it — never
   * normalised to a bare video id here. `extractVideoId` (this module's
   * own `youtube.ts`) and the backend's identical function both parse
   * whatever shape this actually is; keeping the raw text means a
   * customer editing their link later sees what they pasted, not a
   * silently rewritten URL.
   */
  youtubeUrl: string;
  /**
   * Set only after `YouTubeValidateView` has confirmed the link — never
   * written optimistically. Its presence IS the "this link is known
   * good" signal the checkout gate reads; see `validation.ts`.
   */
  youtubeVideoId?: string;
}

export function createInitialState(): SongPosterValues {
  return {
    track: "",
    artist: "",
    dedication: "",
    youtubeUrl: "",
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  // Corrects an earlier version of this function, which set no `theme`
  // at all — a real gap, not a simplification: without a default here,
  // a freshly created project had no theme selection to read, and
  // `getSongPosterTheme(undefined)` only falls back to Player by luck
  // of being first in the registry, not by an actual stated default.
  // `sleevePalette` is set unconditionally too, even though it is only
  // ever READ while Sleeve is selected (`themes.ts`'s `visibleWhen`) —
  // a customer switching TO Sleeve should see Cream already chosen,
  // not an axis that renders with nothing selected the first time it
  // appears. `scale` is kept because the Shell's zoom control reads it
  // generically across every product module, same as before.
  return { theme: DEFAULT_SONG_POSTER_THEME, sleevePalette: DEFAULT_SLEEVE_PALETTE, scale: 100 };
}
