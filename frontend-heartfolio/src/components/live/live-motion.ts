import type { CSSProperties } from "react";

/**
 * THE LIVE PAGE'S MOTION, NAMED.
 *
 * Every number that shapes how the keepsake moves lives here once, is handed to
 * the page as CSS custom properties (`liveMotionStyle`), and is read in the CSS
 * as `var(--live-..., <the same default>)`. Nothing in the stylesheets is a bare
 * magic number, so a future live-style selector can hand a different set of
 * values to the same markup without touching the components, and
 * `live-motion.test.tsx` fails if the CSS fallbacks drift from these.
 *
 * THE BRAND'S MOTION IS RESTRAINED (`motion/reveal.tsx`: "never a slide, never a
 * bounce: elements settle into place like light finding a room"; the opening
 * draws four strokes and a spark catches). These values stay inside that: a
 * milestone fades and rises a little as it is reached, its photograph settles in
 * a touch slower, and a single spark, the brand's own, catches once at its node.
 * No burst, no loop, no overshoot.
 *
 * WHAT THIS DOES NOT COVER, ON PURPOSE: photograph parallax, ambient particles,
 * an animating accent colour, cursor or tilt effects and time-of-day mood were
 * considered and deferred (the photographs are delivered full size and
 * unresized, so nothing may transform them heavily yet; the accent must stay the
 * palette the customer chose).
 */
export const LIVE_MOTION = {
  /** The brand ease, the same curve as `EASE` in `opening-sequence.tsx` and `motion/reveal.tsx`. */
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** How long a milestone takes to arrive. */
  enterMs: 700,
  /** How far below its place a milestone starts, in pixels. */
  enterRisePx: 16,
  /** The size a milestone starts at, as a fraction of its own. */
  enterScale: 0.985,
  /** The size a milestone's photograph starts at inside its frame. */
  photoSettleScale: 1.04,
  /** How long the photograph takes to settle (a little slower than the milestone). */
  photoSettleMs: 1100,
  /** How long the photograph waits for the milestone to begin arriving. */
  photoSettleDelayMs: 120,
  /** How long the spark takes to catch and fade. */
  sparkMs: 1400,
  /** The spark's size, in pixels. */
  sparkSizePx: 18,
} as const;

/** The custom-property name for each value; the CSS reads these. */
export const LIVE_MOTION_VARS = {
  ease: "--live-ease",
  enterMs: "--live-enter-ms",
  enterRisePx: "--live-enter-rise",
  enterScale: "--live-enter-scale",
  photoSettleScale: "--live-photo-settle-scale",
  photoSettleMs: "--live-photo-settle-ms",
  photoSettleDelayMs: "--live-photo-settle-delay",
  sparkMs: "--live-spark-ms",
  sparkSizePx: "--live-spark-size",
} as const satisfies Record<keyof typeof LIVE_MOTION, string>;

const UNITS: Partial<Record<keyof typeof LIVE_MOTION, string>> = {
  enterMs: "ms",
  enterRisePx: "px",
  photoSettleMs: "ms",
  photoSettleDelayMs: "ms",
  sparkMs: "ms",
  sparkSizePx: "px",
};

/**
 * A set of motion values. Widened from the literal types of `LIVE_MOTION` (which
 * is `as const`) so another style can hand over different numbers, not only the
 * exact current ones.
 */
export type LiveMotionValues = { -readonly [K in keyof typeof LIVE_MOTION]: (typeof LIVE_MOTION)[K] extends string ? string : number };

/** The motion values as inline custom properties for the page's root element. */
export function liveMotionStyle(values: Partial<LiveMotionValues> = {}): CSSProperties {
  const merged: Record<string, string | number> = { ...LIVE_MOTION, ...values };
  const style: Record<string, string> = {};
  for (const key of Object.keys(LIVE_MOTION_VARS) as (keyof typeof LIVE_MOTION)[]) {
    style[LIVE_MOTION_VARS[key]] = `${merged[key]}${UNITS[key] ?? ""}`;
  }
  return style as CSSProperties;
}

/**
 * The brand mark's spark, which `ending-spark.tsx` drifts and
 * `milestone-spark.tsx` catches: one source for every copy of the mark since
 * 31 Oct 2026 (`lib/brand/mark.ts`), re-exported here for the live page.
 */
export { SPARK_PATH, SPARK_VIEWBOX } from "@/lib/brand/mark";
