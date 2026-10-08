"use client";

import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import styles from "./song-live-keepsake.module.css";
import { useYouTubePlayer } from "@/lib/studio/product-modules/song-poster/use-youtube-player";
import { downsample, generateEnvelope, seedForOrder } from "@/lib/studio/product-modules/song-poster/waveform";
import { RevealGroup, RevealItem } from "@/components/motion/reveal";
import { EndingSpark } from "@/components/live/ending-spark";

const EASE = [0.22, 1, 0.36, 1] as const;
const WAVE_BARS = 64;

/**
 * ---------------------------------------------------------------------
 * SONG POSTER'S OWN §10 — its digital keepsake, independent of
 * `themeSelections.theme`.
 * ---------------------------------------------------------------------
 * `live-keepsake.tsx`'s own opening comment states Love Story Timeline's
 * version of this principle plainly: "Printable = keepsake you look at.
 * Digital = story you experience." This is that same principle worked
 * out for a different product's own real shape, not that component
 * reused. LST has a chronological journey to animate through; Song
 * Poster has one song. So there is no per-print-theme reskin here (a
 * customer who bought the Ledger print gets the SAME digital keepsake
 * a Player customer gets, the way an LST customer's digital keepsake
 * doesn't care whether their print was vertical or horizontal) and no
 * milestone list to scroll — the ONE experience this product's own
 * data actually supports is: hear the song, see the dedication, see
 * the photo.
 *
 * THE WAVEFORM IS REAL, INTERACTIVE, SEEDED — the same `generateEnvelope`
 * / `downsample` every print theme's own waveform already uses, so a
 * customer who saw Player's static waveform in the Studio preview sees
 * the SAME shape here, now actually scrubbable, not a different
 * decorative approximation built for this one page.
 *
 * MUSIC NEVER AUTOPLAYS — same reasoning `live-keepsake.tsx` already
 * states for Love Story Timeline, true here for the identical reason:
 * a keepsake opening with unexpected sound, possibly in public, is a
 * bad first moment for a gift. `useYouTubePlayer` never calls `play()`
 * on its own; only the person viewing this page does, by pressing the
 * transport button.
 *
 * ---------------------------------------------------------------------
 * TODO (deferred, not forgotten) — a DIFFERENT live experience per
 * print theme, not one universal one.
 * ---------------------------------------------------------------------
 * As of this build there is ONE digital keepsake regardless of which
 * of the eight print themes was purchased — a deliberate choice,
 * following Love Story Timeline's own precedent (one live page,
 * independent of print layout). The person who asked for this build
 * has since asked for eight, later, as a real to-do rather than
 * something to build blind right now. Left here, concretely, rather
 * than only in conversation:
 *
 * WHAT WOULD ACTUALLY CHANGE:
 * - `_build_song_poster_live_payload` (`live_views.py`) would need to
 *   include `theme` from `themeSelections` in its response — dropped
 *   deliberately in this build (see the docstring on that function),
 *   so re-adding it is the first real change, not a formality.
 * - This one component would need to become a dispatcher, the same
 *   shape `theme-registry.ts`'s `getSongPosterTheme` already is for
 *   the STUDIO preview — eight small live components (or eight modes
 *   of one), not eight copies of this whole file.
 * - EACH THEME NEEDS ITS OWN ANSWER to what "digital = experience"
 *   even means for it — this is the real work, not the plumbing.
 *   Player's answer is this file, close to as-is (it already has real
 *   playback). Ledger/Ephemeris/Label/Award are static compositions
 *   today with no interactive element at all — a live page for them
 *   is not obviously "the same thing, different skin"; it may need
 *   its own design thinking per theme, the same care each print theme
 *   itself got when it was built.
 * - Sleeve's SIX PALETTES (`sleeve-theme.tsx`'s own `SLEEVE_PALETTES`)
 *   would need to reach this page too, if Sleeve gets a live version
 *   — another real product decision, not just wiring.
 *
 * NOT STARTED HERE. Flagging the shape of the work, not doing it —
 * scoping eight products' worth of "what does this feel like" is real
 * design work, not something to default into while building something
 * else.
 */
export interface SongLiveKeepsakeProps {
  values: {
    track: string;
    artist: string;
    dedication?: string;
    // `| null`, not just `?:` — the live payload's own JSON sends
    // `"photo": null` explicitly when there is none (see `live_views.
    // py`'s `_build_song_poster_live_payload`), not an omitted key.
    // Optional chaining (`values.photo?.url` below) already handles
    // both the same way; only the type needed to say so.
    photo?: { url: string } | null;
    youtubeVideoId: string | null;
  };
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const MARK_PATHS = [
  "M32 22 A 10 10 0 0 0 14 31.5 L32 50",
  "M41 23 L23 40.5",
  "M23 23 L41 40.5",
  "M32 22 A 10 10 0 0 1 50 31.5 L32 50",
] as const;

function OpeningMark() {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <motion.svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ width: 40, height: 40, color: "var(--accent)" }}
      initial="hidden"
      animate="drawn"
    >
      <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
        {MARK_PATHS.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            variants={{ hidden: { pathLength: 0, opacity: 0.4 }, drawn: { pathLength: 1, opacity: 1 } }}
            transition={{ duration: 0.8, ease: EASE, delay: i * 0.1 }}
          />
        ))}
      </g>
    </motion.svg>
  );
}

export function SongLiveKeepsake({ values }: SongLiveKeepsakeProps) {
  const [state, controls] = useYouTubePlayer(values.youtubeVideoId);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const bars = useMemo(() => {
    if (!values.track && !values.artist) return null;
    const seed = seedForOrder(values.track, values.artist);
    return downsample(generateEnvelope(seed), WAVE_BARS);
  }, [values.track, values.artist]);

  const progress = state.duration > 0 ? state.currentTime / state.duration : 0;

  function seekFromClientX(clientX: number) {
    const el = waveRef.current;
    if (!el || state.duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    controls.seekTo(ratio * state.duration);
  }

  return (
    <main className={styles.root}>
      <div className={styles.stage}>
        <OpeningMark />

        <RevealGroup>
          {values.photo?.url && (
            <RevealItem className={styles.photo}>
              {/* eslint-disable-next-line @next/next/no-img-element --
                  a private, per-order URL, same reasoning as every
                  other photo in the Love Story Timeline live page. */}
              <img src={values.photo.url} alt="" />
            </RevealItem>
          )}

          <RevealItem>
            <h1 className={styles.track}>{values.track}</h1>
            <p className={styles.artist}>{values.artist}</p>
          </RevealItem>

          <RevealItem className={styles.transport}>
            <button
              type="button"
              className={styles.playButton}
              onClick={controls.toggle}
              disabled={!state.isReady}
              aria-label={state.isPlaying ? "Pause" : "Play"}
            >
              {state.isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>

            {bars && (
              <div
                ref={waveRef}
                className={styles.waveform}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(state.duration)}
                aria-valuenow={Math.round(state.currentTime)}
                tabIndex={state.isReady ? 0 : -1}
                onPointerDown={(e) => {
                  if (!state.isReady) return;
                  setDragging(true);
                  seekFromClientX(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (dragging) seekFromClientX(e.clientX);
                }}
                onPointerUp={() => setDragging(false)}
                onPointerLeave={() => setDragging(false)}
                onKeyDown={(e) => {
                  if (!state.isReady) return;
                  if (e.key === "ArrowRight") controls.seekTo(Math.min(state.duration, state.currentTime + 5));
                  if (e.key === "ArrowLeft") controls.seekTo(Math.max(0, state.currentTime - 5));
                }}
              >
                <svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="100%">
                  {Array.from(bars).map((v, i) => {
                    const x = (i + 0.5) * (1000 / WAVE_BARS);
                    const h = Math.max(4, v * 80);
                    const played = i / WAVE_BARS <= progress;
                    return (
                      <rect
                        key={i}
                        x={(x - 5).toFixed(2)}
                        y={(50 - h / 2).toFixed(2)}
                        width={10}
                        height={h.toFixed(2)}
                        rx={2}
                        fill="currentColor"
                        opacity={played ? 0.9 : 0.28}
                      />
                    );
                  })}
                </svg>
              </div>
            )}

            <div className={styles.times}>
              <span>{formatTime(state.currentTime)}</span>
              <span>{formatTime(state.duration)}</span>
            </div>

            {state.error && <p className={styles.error}>{state.error}</p>}
          </RevealItem>

          {values.dedication && <RevealItem as="p" className={styles.dedication}>{values.dedication}</RevealItem>}
        </RevealGroup>
      </div>

      <div className={styles.ending}>
        <EndingSpark />
        <p className={styles.colophon}>
          <a href="https://theheartfolio.com">Made with Heartfolio · theheartfolio.com</a>
        </p>
      </div>
    </main>
  );
}
