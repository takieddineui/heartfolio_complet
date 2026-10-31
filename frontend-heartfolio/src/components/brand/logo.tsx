/**
 * The Heartfolio logo, inline.
 *
 * INLINE RATHER THAN <img src="/assets/logo-full.svg">, because an <img>
 * is opaque: its gradients cannot be restyled, it cannot inherit
 * `currentColor`, it cannot be faded per-variant, and it costs a second
 * network request on the first paint of every page. The lockup lives in
 * `public/assets/logo-full.svg` as well, for the places that genuinely
 * need a file — email, og images, a partner's brand sheet — and the
 * geometry below is the same.
 *
 * GRADIENT IDS ARE SCOPED PER INSTANCE. SVG ids are global to the
 * document, so two of these on one page would both resolve their
 * `url(#hf-ribbon)` to whichever rendered first. `useId` makes that
 * impossible, and it is the specific bug that makes hand-written SVG
 * components mysteriously lose their colour when reused.
 */
"use client";

import { useId } from "react";
import { MARK_GRADIENTS, MARK_STROKES, MARK_STROKE_WIDTH, SPARK_PATH } from "@/lib/brand/mark";

/** The full lockup's own gradient boxes: the mark is scaled into a 320-wide
 *  canvas there, and these were set by eye for it (`logo-full.svg`). */
const FULL_GRADIENTS = {
  ribbon: { x1: 120, y1: 12, x2: 200, y2: 94 },
  over: { x1: 134, y1: 26, x2: 186, y2: 86 },
  spark: { x1: 188, y1: 8, x2: 208, y2: 34 },
} as const;

export type LogoVariant = "full" | "mark";

export function Logo({
  variant = "full",
  className,
  title = "Heartfolio",
  monochrome = false,
}: {
  variant?: LogoVariant;
  className?: string;
  /** Accessible name. Pass `null` when the logo sits beside the word
   *  "Heartfolio" in text, so screen readers do not say it twice. */
  title?: string | null;
  /** Ignore the gradients and paint everything in `currentColor`. For
   *  places the brand colours cannot survive: a single-colour print, a
   *  dark toolbar, an email client that strips gradients. */
  monochrome?: boolean;
}) {
  const uid = useId();
  const ribbon = `hf-ribbon-${uid}`;
  const over = `hf-over-${uid}`;
  const spark = `hf-spark-${uid}`;
  const word = `hf-word-${uid}`;

  const paint = (id: string) => (monochrome ? "currentColor" : `url(#${id})`);
  const isFull = variant === "full";

  return (
    <svg
      viewBox={isFull ? "0 0 320 152" : "0 0 64 64"}
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      // No width/height: the caller sizes it with a class, as every other
      // icon in this codebase is sized.
    >
      {!monochrome && (
        <defs>
          {(["ribbon", "over", "spark"] as const).map((key) => {
            const gradient = MARK_GRADIENTS[key];
            const box = isFull ? FULL_GRADIENTS[key] : gradient;
            return (
              <linearGradient
                key={key}
                id={{ ribbon, over, spark }[key]}
                x1={box.x1}
                y1={box.y1}
                x2={box.x2}
                y2={box.y2}
                gradientUnits="userSpaceOnUse"
              >
                {gradient.stops.map(([offset, color]) => (
                  <stop key={offset} offset={offset} stopColor={color} />
                ))}
              </linearGradient>
            );
          })}
          <linearGradient id={word} x1="40" y1="0" x2="280" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#E9A9A0" />
            <stop offset="0.42" stopColor="#E0A487" />
            <stop offset="1" stopColor="#D08F55" />
          </linearGradient>
        </defs>
      )}

      {/* The mark (`lib/brand/mark.ts`). In the full lockup it is the same
          geometry, scaled and nudged down to leave room for the wordmark. */}
      <g transform={isFull ? "translate(102.4 4) scale(1.8)" : undefined}>
        <g fill="none" strokeWidth={MARK_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          {/* Paint order is the weave — see icon.svg. */}
          {MARK_STROKES.map((stroke) => (
            <path key={stroke.d} stroke={paint(stroke.paint === "over" ? over : ribbon)} d={stroke.d} />
          ))}
        </g>
        <path fill={paint(spark)} d={SPARK_PATH} />
      </g>

      {isFull && (
        <text
          x="160"
          y="142"
          textAnchor="middle"
          fontFamily="var(--font-sans, 'Inter', 'Helvetica Neue', Arial, sans-serif)"
          fontSize="34"
          fontWeight="500"
          letterSpacing="6"
          fill={paint(word)}
        >
          HEARTFOLIO
        </text>
      )}
    </svg>
  );
}
