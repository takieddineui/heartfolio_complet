import type { ProductRendererProps, ThemeSelections } from "@/types/studio";
import type { SongPosterValues } from "./initial-state";
import { getSongPosterTheme } from "./theme-registry";

/**
 * A thin adapter and nothing more — same shape as Love Story Timeline's
 * own live-preview adapter. DISPATCHES BY `themeSelections.theme`,
 * correcting the earlier version of this file, which imported and
 * rendered `PlayerTheme` directly — the exact hardcoding
 * `theme-registry.ts`'s own comment explains was a real gap, not a
 * placeholder: two themes with no way to switch between them.
 *
 * `liveCodeSvg` IS NOT SET HERE, for every theme. The real QR links to
 * a paid order's live page, which does not exist while someone is
 * still composing in the Studio — the same reason a live keepsake
 * preview has nothing to link to yet either. Each theme component
 * already renders nothing in that slot when `liveCodeSvg` is absent;
 * the PRINT/WALLPAPER renderer is where the real card belongs,
 * generated at delivery time from the actual order.
 */
export function SongPosterRenderer({ values, themeSelections, locale }: ProductRendererProps<SongPosterValues>) {
  const theme = getSongPosterTheme(themeSelections.theme as string | undefined);
  const Component = theme.component;
  return (
    <Component
      track={values.track}
      artist={values.artist}
      dedication={values.dedication}
      photoUrl={values.photo?.url}
      youtubeVideoId={values.youtubeVideoId ?? null}
      sleevePaletteId={themeSelections.sleevePalette as string | undefined}
      locale={locale}
    />
  );
}

/**
 * `livePreview.component`'s narrower contract — `{values,
 * themeSelections, locale}`, no `tokens`/`t` — same reasoning as
 * `SongPosterRenderer` above for why this is its own function rather
 * than the wider-typed one reused; see that file's original comment
 * (kept in git history) for the full explanation of the type gap.
 */
export function SongPosterLivePreview({
  values,
  themeSelections,
  locale,
}: {
  values: SongPosterValues;
  themeSelections: ThemeSelections;
  locale: string;
}) {
  const theme = getSongPosterTheme(themeSelections.theme as string | undefined);
  const Component = theme.component;
  return (
    <Component
      track={values.track}
      artist={values.artist}
      dedication={values.dedication}
      photoUrl={values.photo?.url}
      youtubeVideoId={values.youtubeVideoId ?? null}
      sleevePaletteId={themeSelections.sleevePalette as string | undefined}
      locale={locale}
    />
  );
}
