/**
 * THE HEARTFOLIO MARK: the one source of its geometry and colours outside
 * the two static files (`src/app/icon.svg`, `public/assets/logo-full.svg`),
 * which `brand.test.ts` pins to this module.
 *
 * Everything that draws the mark takes it from here or from `icon.svg`
 * (owner, 31 Oct 2026, after the QR card's hand-drawn copy was found to be a
 * different shape in flat colours): the site's `Logo`, the live-page intro,
 * the sparks, the share cards (`icon.svg` itself), and every backend
 * deliverable, which pastes `backend/apps/delivery/brand/mark.png`, rendered
 * from `icon.svg` by `scripts/brand/render-mark.mjs`. `brand.test.ts` fails
 * if any other file carries the geometry, or if the PNG no longer matches.
 */

export const MARK_VIEWBOX = "0 0 64 64";

/** Round caps and joins, 5 units wide: the ribbon's own pen. */
export const MARK_STROKE_WIDTH = 5;

export type MarkGradientId = "ribbon" | "over" | "spark";

/** The four bands. Paint order IS the weave: reordering them turns the knot
 *  into a tangle. `over` is the band that passes over. */
export const MARK_STROKES: readonly { d: string; paint: Exclude<MarkGradientId, "spark"> }[] = [
  { d: "M32 22 A 10 10 0 0 0 14 31.5 L32 50", paint: "ribbon" },
  { d: "M41 23 L23 40.5", paint: "over" },
  { d: "M23 23 L41 40.5", paint: "ribbon" },
  { d: "M32 22 A 10 10 0 0 1 50 31.5 L32 50", paint: "ribbon" },
];

/** The four-point star off the upper-right shoulder, filled. */
export const SPARK_PATH = "M51 7 L52.8 13.2 L59 15 L52.8 16.8 L51 23 L49.2 16.8 L43 15 L49.2 13.2 Z";

/** The spark's own box, for drawing it alone. */
export const SPARK_VIEWBOX = "43 6 16 17";

/** Gradients in the mark's 64-unit space (`gradientUnits="userSpaceOnUse"`). */
export const MARK_GRADIENTS: Record<
  MarkGradientId,
  { x1: number; y1: number; x2: number; y2: number; stops: readonly [offset: number, color: string][] }
> = {
  ribbon: { x1: 10, y1: 12, x2: 54, y2: 52, stops: [[0, "#EBB0A6"], [0.5, "#DE9B85"], [1, "#C5854F"]] },
  over: { x1: 18, y1: 18, x2: 46, y2: 46, stops: [[0, "#D89A8C"], [1, "#B8763F"]] },
  spark: { x1: 46, y1: 6, x2: 57, y2: 21, stops: [[0, "#FFEBCF"], [1, "#E0A765"]] },
};

/**
 * The wordmark as the site sets it beside the mark (the header, measured
 * 31 Oct 2026): "Heartfolio" in Heartfolio Serif (Fraunces) at weight 400,
 * letter-spacing -0.025em, the mark 1.4x the text size and 0.5em from it.
 * The backend draws the same (`apps/delivery/brand`), pinned by `brand.test.ts`.
 */
export const WORDMARK = {
  text: "Heartfolio",
  weight: 400,
  trackingEm: -0.025,
  markToTextRatio: 1.4,
  gapEm: 0.5,
} as const;
