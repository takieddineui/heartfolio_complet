"use client";

import { useEffect, useRef, type CSSProperties, type Ref } from "react";
import type { Media } from "./experience-data";
import styles from "./graduation-keepsake.module.css";

/** `cx("pass", "passMain")`: the module's hashed class names from the
 * prototype's readable ones. */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names
    .filter(Boolean)
    .map((name) => styles[name as string] ?? "")
    .join(" ");

const ICONS = {
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  replay: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth={3} />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  on: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
  off: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></>,
} as const;

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className={cx("ic")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Plane() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
    </svg>
  );
}

/**
 * A photo or drawing. Loads lazily and decodes off the main thread with its
 * shape reserved by CSS, so nothing jumps (the live page's photos are
 * delivered at the size uploaded; see CLAUDE.md). A failed load reports back:
 * on the live page its five-minute link may simply have expired, and the page
 * fetches fresh ones. No photo yet (the Studio, before an upload) is a calm
 * placeholder, never a broken image.
 *
 * A photo can fail BEFORE React is listening: the hero is in the server's
 * HTML, so an expired link fails during page load and its `onError` never
 * runs (measured on the live page: the refresh never happened). So on mount
 * the photo also checks whether it has already failed.
 */
export function Photo({
  media,
  alt,
  className,
  eager,
  onError,
}: {
  media: Media;
  alt: string;
  className?: string;
  eager?: boolean;
  onError?: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const url = media?.url;
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && url) onError?.();
    // Only when the link changes: a fresh link that also fails reports itself
    // through `onError` as usual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  if (!media) {
    return (
      <span className={[cx("ph"), className].filter(Boolean).join(" ")} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
        ✦
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={media.url}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      width={480}
      height={360}
      onError={onError}
    />
  );
}

export const TROPHIES = ["🏆", "🥇", "🏅", "⭐", "💎", "👑", "🎖️", "🌟", "🔥", "🎯"];
export const STAMP_INKS = ["#2f7fd8", "#d64545", "#1f8a5f", "#7a5cd6", "#c2410c", "#0f2742", "#b8860b", "#c95ab0", "#2fae86", "#ff6b4a"];
/** Fix 8: at most six degrees (the prototype went to fourteen), so a stamp
 * holding a 26-character title never leans into its neighbour. */
export const STAMP_TILTS = [-6, 5, -3, 6, -5, 4];
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function SummitPeaks() {
  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 200 L70 90 L120 140 L200 30 L270 120 L320 80 L400 150 V200Z" fill="#4b5f84" />
      <path d="M200 30 L218 58 L206 54 L196 66 L186 52Z" fill="#fff" />
      <path d="M0 200 L90 140 L170 170 L260 120 L400 180 V200Z" fill="#30476b" />
    </svg>
  );
}

export function Jet({ jetRef }: { jetRef: Ref<SVGGElement> }) {
  return (
    <svg viewBox="0 0 520 220" style={{ width: "min(96cqw, 520px)", overflow: "visible" }} aria-hidden="true">
      <path d="M0 190 H520 V220 H0Z" fill="#4a5560" />
      <path d="M0 205 H520" stroke="#fff" strokeWidth={3} strokeDasharray="26 18" />
      <g ref={jetRef} transform="translate(40 150)">
        <path d="M0 22 Q10 12 40 12 H120 Q138 12 146 20 Q138 30 120 30 H40 Q14 30 0 22Z" fill="#fffaf1" stroke="#0f2742" strokeWidth={2} />
        <path d="M70 20 L50 -6 H64 L96 20Z" fill="#ff6b4a" />
        <path d="M6 20 L0 2 H12 L22 18Z" fill="#ff6b4a" />
      </g>
    </svg>
  );
}

export function Rocket({ rocketRef, flame }: { rocketRef: Ref<SVGSVGElement>; flame: boolean }) {
  return (
    <svg ref={rocketRef} className={cx("rocket")} viewBox="0 0 60 120" aria-hidden="true">
      <path d="M30 0 Q50 30 46 80 H14 Q10 30 30 0Z" fill="#e8f3ff" />
      <circle cx="30" cy="42" r="8" fill="#7cf3ff" stroke="#2a3560" strokeWidth={3} />
      <path d="M14 64 L0 96 L14 90Z M46 64 L60 96 L46 90Z" fill="#ff8a3d" />
      <path d="M20 80 H40 L36 92 H24Z" fill="#9aa7bb" />
      <path d="M24 92 Q30 125 36 92Z" fill="#ffb547" opacity={flame ? 1 : 0} />
    </svg>
  );
}

export function SummitFinale({ sunRef, flag }: { sunRef: Ref<HTMLDivElement>; flag: boolean }) {
  return (
    <>
      <div ref={sunRef} className={cx("sun")} />
      <div className={cx("mts")} aria-hidden="true">
        <svg viewBox="0 0 400 160" preserveAspectRatio="none">
          <path d="M0 160 L80 70 L140 110 L200 20 L260 100 L330 60 L400 120 V160Z" fill="#4b5f84" />
          <path d="M200 20 V-14" stroke="#5a3818" strokeWidth={3} />
          <path d="M201 -14 L226 -6 L201 2Z" fill="#e2553b" opacity={flag ? 1 : 0} />
          <path d="M0 160 L100 120 L190 140 L280 100 L400 150 V160Z" fill="#30476b" />
        </svg>
      </div>
    </>
  );
}

export const tilt = (deg: number, ink: string) => ({ "--sc": ink, "--r": `${deg}deg` }) as CSSProperties;
