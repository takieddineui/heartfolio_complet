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
          <linearGradient
            id={ribbon}
            x1={isFull ? 120 : 10}
            y1={isFull ? 12 : 12}
            x2={isFull ? 200 : 54}
            y2={isFull ? 94 : 52}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#EBB0A6" />
            <stop offset="0.5" stopColor="#DE9B85" />
            <stop offset="1" stopColor="#C5854F" />
          </linearGradient>
          <linearGradient
            id={over}
            x1={isFull ? 134 : 18}
            y1={isFull ? 26 : 18}
            x2={isFull ? 186 : 46}
            y2={isFull ? 86 : 46}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#D89A8C" />
            <stop offset="1" stopColor="#B8763F" />
          </linearGradient>
          <linearGradient
            id={spark}
            x1={isFull ? 188 : 46}
            y1={isFull ? 8 : 6}
            x2={isFull ? 208 : 57}
            y2={isFull ? 34 : 21}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFEBCF" />
            <stop offset="1" stopColor="#E0A765" />
          </linearGradient>
          <linearGradient id={word} x1="40" y1="0" x2="280" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#E9A9A0" />
            <stop offset="0.42" stopColor="#E0A487" />
            <stop offset="1" stopColor="#D08F55" />
          </linearGradient>
        </defs>
      )}

      {/* The mark. In the full lockup it is the same geometry, scaled and
          nudged down to leave room for the wordmark. */}
      <g transform={isFull ? "translate(102.4 4) scale(1.8)" : undefined}>
        <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          {/* Paint order is the weave — see icon.svg. */}
          <path stroke={paint(ribbon)} d="M32 22 A 10 10 0 0 0 14 31.5 L32 50" />
          <path stroke={paint(over)} d="M41 23 L23 40.5" />
          <path stroke={paint(ribbon)} d="M23 23 L41 40.5" />
          <path stroke={paint(ribbon)} d="M32 22 A 10 10 0 0 1 50 31.5 L32 50" />
        </g>
        <path
          fill={paint(spark)}
          d="M51 7 L52.8 13.2 L59 15 L52.8 16.8 L51 23 L49.2 16.8 L43 15 L49.2 13.2 Z"
        />
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
