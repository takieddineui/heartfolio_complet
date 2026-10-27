"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play } from "lucide-react";
import type { CaptureStillEntry, ProductCaptures } from "@/lib/captures/manifest";
import { useExclusivePlayback } from "./exclusive-playback";

/**
 * How the storefront shows its product captures (real recordings of each
 * live page, `lib/captures/manifest.ts`).
 *
 * FAST ON A PHONE, BY CONSTRUCTION:
 * - The still is a <picture> (AVIF, JPEG fallback) with its real width and
 *   height, so its space is reserved before it loads (no layout shift), and
 *   lazy unless it is the page's main image.
 * - The <video> element does not exist until it should play (and never before
 *   the page has loaded), so a visitor who
 *   never hovers a card, never scrolls to a loop, asks for reduced motion or
 *   has data saver on never requests a single video byte. `preload="none"`.
 * - It plays only while visible (or hovered, on cards), pauses when the tab
 *   is hidden, and is muted with `playsInline` so iPhones play it in place.
 * - A loop that plays by itself has a pause button (WCAG 2.2.2: moving
 *   content longer than 5 seconds must be pausable).
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Motion is allowed only when the visitor did not ask for less of it and
 *  is not saving data. False on the server: no video is ever rendered there. */
export function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      // Without matchMedia (no real browser lacks it), assume the safe side.
      if (typeof window.matchMedia !== "function") return false;
      const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
      return !window.matchMedia(REDUCED_MOTION).matches && !saveData;
    },
    () => false
  );
}

function subscribeToLoad(onChange: () => void) {
  window.addEventListener("load", onChange);
  return () => window.removeEventListener("load", onChange);
}

/** True once the window's load event has fired; false on the server. */
export function usePageLoaded(): boolean {
  return useSyncExternalStore(subscribeToLoad, () => document.readyState === "complete", () => false);
}

/** A plain phone: no brand's hardware, just a dark rounded frame. */
export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[2.1rem] bg-ink-navy p-[7px] shadow-[var(--shadow-float)] ${className}`}>
      <div className="relative overflow-hidden rounded-[1.65rem] bg-parchment">{children}</div>
    </div>
  );
}

export function CaptureStill({
  still,
  alt,
  priority = false,
  className = "",
}: {
  still: CaptureStillEntry;
  alt: string;
  /** The page's main image: loaded at once and first. */
  priority?: boolean;
  className?: string;
}) {
  return (
    <picture>
      <source srcSet={still.avif.src} type="image/avif" />
      {/* A plain <img> on purpose: fixed, pre-sized files in public/captures,
          AVIF with a JPEG fallback; next/image would re-encode what the
          capture script already sized. */}
      <img
        src={still.jpg.src}
        width={still.width}
        height={still.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={`block h-auto w-full ${className}`}
      />
    </picture>
  );
}

/**
 * A product's loop over its still. `mode="hover"`: plays while `active`
 * (the card is hovered or focused). `mode="inView"`: plays while on screen,
 * with a pause button.
 */
export function CaptureLoop({
  captures,
  alt,
  mode,
  active = false,
  priority = false,
  exclusive,
}: {
  captures: Pick<ProductCaptures, "loop" | "poster">;
  alt: string;
  mode: "hover" | "inView";
  active?: boolean;
  priority?: boolean;
  /** A group name: loops sharing it play one at a time, the most recent to
   *  come on screen (`exclusive-playback.ts`). */
  exclusive?: string;
}) {
  const t = useTranslations("Captures");
  const motionAllowed = useMotionAllowed();
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [userPaused, setUserPaused] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Nothing heavy before the page itself has loaded: the first loop waits
  // for the window's load event, so it never competes with the page's own
  // images, fonts and scripts.
  const pageLoaded = usePageLoaded();

  useEffect(() => {
    if (mode !== "inView" || !frameRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const loop = captures.loop;
  const wanted = mode === "hover" ? active : inView && !userPaused;
  const canPlay = Boolean(loop) && motionAllowed && pageLoaded && pageVisible && wanted;
  // In a group, only the most recent loop that wants to play does.
  const turn = useExclusivePlayback(exclusive, canPlay);
  const shouldPlay = canPlay && turn;

  // The video is created the first time it should play, and kept after that
  // (recorded during render, React's pattern for state derived from props).
  if (shouldPlay && !mounted) setMounted(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (shouldPlay) void video.play().catch(() => {});
    else video.pause();
  }, [shouldPlay, mounted]);

  if (!captures.poster) return null;

  return (
    <div ref={frameRef} className="relative">
      <CaptureStill still={captures.poster} alt={alt} priority={priority} />
      {loop && mounted && motionAllowed && (
        <video
          ref={videoRef}
          src={loop.src}
          poster={captures.poster.jpg.src}
          width={loop.width}
          height={loop.height}
          muted
          playsInline
          loop
          autoPlay
          preload="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {mode === "inView" && loop && motionAllowed && (
        <button
          type="button"
          onClick={() => setUserPaused((paused) => !paused)}
          aria-label={userPaused ? t("play") : t("pause")}
          className="absolute bottom-3 end-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink-navy/70 text-parchment backdrop-blur-sm transition-colors hover:bg-ink-navy/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne-gold"
        >
          {userPaused ? <Play className="h-4 w-4" fill="currentColor" /> : <Pause className="h-4 w-4" fill="currentColor" />}
        </button>
      )}
    </div>
  );
}
