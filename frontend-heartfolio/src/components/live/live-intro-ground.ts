import { GIFTS } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";
import { liveThemeStyle } from "./live-theme";

/**
 * The colour each live page opens on, and its text colour, so the shared
 * intro (`live-intro.tsx`) is drawn on the gift's own ground and fades into
 * it without a flash. `live-intro.test.tsx` pins every value against the
 * product's own stylesheet or theme.
 */
export interface IntroGround {
  bg: string;
  ink: string;
}

/** Song Poster's page (`song-live-keepsake.module.css`, `--paper`/`--ink`). */
export const SONG_GROUND: IntroGround = { bg: "#f6f2e9", ink: "#171512" };

/** Reasons I Love You, per gift (`reasons-keepsake.module.css`, `--bg`/`--ink`). */
export const REASONS_GROUNDS: Record<string, IntroGround> = {
  jar: { bg: "#f6e7d3", ink: "#4a3424" },
  daisy: { bg: "#cfe8d5", ink: "#2d4a36" },
  deck: { bg: "#163d2c", ink: "#f3ecd8" },
  cookies: { bg: "#f3dcc0", ink: "#5a2e1c" },
};

/** Graduation Keepsake, per journey (`graduation-keepsake.module.css`). */
export const GRADUATION_GROUNDS: Record<string, IntroGround> = {
  airline: { bg: "#d9f0fb", ink: "#0f2742" },
  space: { bg: "#070b1f", ink: "#e8f3ff" },
  arcade: { bg: "#1b1036", ink: "#f4ecff" },
  museum: { bg: "#23382f", ink: "#f4efe4" },
  summit: { bg: "#e9eef3", ink: "#1f2f45" },
};

/** Any product not listed opens on the brand's cream. */
export const DEFAULT_GROUND: IntroGround = { bg: "#f7f1e6", ink: "#3a3a38" };

export function introGround(
  productId: string | null,
  values: Record<string, unknown>,
  themeSelections?: Record<string, string | number>
): IntroGround {
  if (productId === "song-poster") return SONG_GROUND;
  if (productId === "reasons-i-love-you") return REASONS_GROUNDS[String(values.gift)] ?? REASONS_GROUNDS[Object.keys(GIFTS)[0]!]!;
  if (productId === "graduation-keepsake") return GRADUATION_GROUNDS[String(values.journey)] ?? GRADUATION_GROUNDS.airline!;
  if (productId === null || productId === "love-story-timeline") {
    // Love Story Timeline: the order's own palette, as its page draws it.
    const style = liveThemeStyle(themeSelections) as Record<string, string>;
    return { bg: style["--paper"] ?? DEFAULT_GROUND.bg, ink: style["--ink"] ?? DEFAULT_GROUND.ink };
  }
  return DEFAULT_GROUND;
}
