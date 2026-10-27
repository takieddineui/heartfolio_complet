"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play } from "lucide-react";
import type { ProductCaptures } from "@/lib/captures/manifest";
import { CaptureStill, PhoneFrame, useMotionAllowed, usePageLoaded } from "./capture-media";

export interface ShowcaseItem {
  id: string;
  name: string;
  captures: Pick<ProductCaptures, "loop" | "poster">;
}

/**
 * The home hero: ONE phone cycling the products' loops, each to its end and
 * then a cross-fade to the next. Dots under it name the products and jump
 * between them; the pause button beside them stops it (WCAG 2.2.2).
 *
 * The same rules as every capture (`capture-media.tsx`): the stills reserve
 * their space; no video exists before the page has loaded, while the phone
 * is off screen or the tab hidden, or ever under reduced motion or data
 * saver (stills only, and nothing advances by itself). Only the product on
 * screen has a video; the next one's still is fetched while it plays, so the
 * fade never waits on the network.
 */
export function CaptureShowcase({ items, label }: { items: ShowcaseItem[]; label: string }) {
  const t = useTranslations("Captures");
  const motionAllowed = useMotionAllowed();
  const pageLoaded = usePageLoaded();
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [userPaused, setUserPaused] = useState(false);
  // Indexes whose still (and, once played, video) has been created.
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [videos, setVideos] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    if (!frameRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const next = (current + 1) % items.length;
  const playing = motionAllowed && pageLoaded && pageVisible && inView && !userPaused && Boolean(items[current]?.captures.loop);

  // Derived during render (React's pattern for state that follows props):
  // the current product's video is created the first time it should play,
  // and the next product's still starts loading at the same moment.
  if (playing && !videos.has(current)) setVideos(new Set(videos).add(current));
  const wanted = playing ? [current, next] : [current];
  if (wanted.some((index) => !seen.has(index))) setSeen(new Set([...seen, ...wanted]));

  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === current && playing) void video.play().catch(() => {});
      else video.pause();
    });
  }, [current, playing, videos]);

  const show = (index: number) => {
    const video = videoRefs.current[index];
    if (video) video.currentTime = 0;
    setCurrent(index);
  };

  if (items.length === 0 || !items[0]!.captures.poster) return null;

  return (
    <div className="flex flex-col items-center" role="group" aria-roledescription="carousel" aria-label={label}>
      <div ref={frameRef} className="w-full">
        <PhoneFrame>
          {items.map((item, index) => {
            const poster = item.captures.poster;
            const loop = item.captures.loop;
            if (!poster || !seen.has(index)) return null;
            const isCurrent = index === current;
            return (
              <div
                key={item.id}
                // The first still sits in the flow and sizes the frame; the
                // others lie over it (all four are recorded at one size).
                className={`${index === 0 ? "relative" : "absolute inset-0"} transition-opacity duration-700 ease-out motion-reduce:transition-none ${isCurrent ? "opacity-100" : "opacity-0"}`}
                aria-hidden={!isCurrent}
              >
                <CaptureStill
                  still={poster}
                  alt={isCurrent ? t("phoneAlt", { name: item.name }) : ""}
                  priority={index === 0}
                />
                {loop && motionAllowed && videos.has(index) && (
                  <video
                    ref={(node) => {
                      videoRefs.current[index] = node;
                    }}
                    src={loop.src}
                    poster={poster.jpg.src}
                    width={loop.width}
                    height={loop.height}
                    muted
                    playsInline
                    preload="none"
                    aria-hidden="true"
                    onEnded={() => {
                      if (index === current) show(next);
                    }}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </div>
            );
          })}
        </PhoneFrame>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="flex items-center gap-1">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => show(index)}
              aria-label={item.name}
              aria-current={index === current ? "true" : undefined}
              className="group flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne-gold"
            >
              <span
                className={`block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none ${index === current ? "w-5 bg-champagne-gold" : "w-2 bg-parchment/35 group-hover:bg-parchment/60"}`}
              />
            </button>
          ))}
        </div>
        {motionAllowed && (
          <button
            type="button"
            onClick={() => setUserPaused((paused) => !paused)}
            aria-label={userPaused ? t("play") : t("pause")}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-parchment/25 text-parchment/80 transition-colors hover:border-parchment/50 hover:text-parchment focus-visible:outline focus-visible:outline-2 focus-visible:outline-champagne-gold"
          >
            {userPaused ? <Play className="h-3.5 w-3.5" fill="currentColor" /> : <Pause className="h-3.5 w-3.5" fill="currentColor" />}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs tracking-wide text-parchment/60">{items[current]!.name}</p>
    </div>
  );
}
