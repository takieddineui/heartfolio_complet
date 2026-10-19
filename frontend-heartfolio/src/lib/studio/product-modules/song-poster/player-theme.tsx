"use client";

import { useMemo, useRef } from "react";
import { useYouTubePlayer } from "./use-youtube-player";
import { downsample, generateEnvelope, seedForOrder } from "./waveform";
import styles from "./player-theme.module.css";
import posterRoot from "./poster-root.module.css";
import { lineDirection } from "./line-direction";

const EQ_BARS = 60;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 1000;

export interface PlayerThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  /** Resolved and validated by `YouTubeValidateView` before the customer
   *  can reach checkout — this component trusts it, rather than
   *  re-validating, exactly as `EntitlementDownloadAPITests`-style
   *  ownership checks live at one layer and are trusted above it. */
  youtubeVideoId: string | null;
  liveCodeSvg?: React.ReactNode;
  /** Read only by Sleeve — see that theme's own `SleeveThemeProps` for
   *  why it lives on the shared contract instead of a special-cased
   *  branch in the renderer adapter. */
  sleevePaletteId?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerTheme({ track, artist, dedication, photoUrl, youtubeVideoId, liveCodeSvg }: PlayerThemeProps) {
  const [state, controls] = useYouTubePlayer(youtubeVideoId);
  const progressRef = useRef<HTMLDivElement | null>(null);

  /**
   * THE SAME SEED THE PRINT WILL USE. `seedForOrder(track, artist)` is
   * the identical expression `waveform.py`'s `seed_for_order` computes —
   * see that file, and this module's own `waveform.ts`, for the parity
   * proof. Recomputed only when track/artist change, not on every
   * keystroke of an unrelated field.
   */
  const bars = useMemo(() => {
    if (!track && !artist) return null;
    const seed = seedForOrder(track, artist);
    return downsample(generateEnvelope(seed), EQ_BARS);
  }, [track, artist]);

  /**
   * PLAYBACK-DRIVEN, NOT THE OLD `momentFrac()` CALCULATION. The
   * prototype computed the knob/fill position from a typed "moment"
   * timestamp divided by typed duration — a static guess. Once a real
   * YouTube video is attached, its own reported `duration`/`currentTime`
   * are what is actually true, so they take over entirely; the fallback
   * only matters before a valid link exists (still composing, or the
   * link hasn't validated yet).
   */
  const hasPlayback = state.isReady && state.duration > 0;
  const fraction = hasPlayback ? Math.min(1, state.currentTime / state.duration) : 0;
  const fillPercent = (fraction * 100).toFixed(2);

  function handleSeek(event: React.MouseEvent<HTMLDivElement>) {
    if (!hasPlayback || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    controls.seekTo(ratio * state.duration);
  }

  return (
    <div
      dir="ltr"
      className={`${styles.sheet} ${posterRoot.root}`}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="player-theme"
    >
      <div className={styles.photo}>
        {/* Plain <img>, matching the Studio's own uploaded-photo pattern
            elsewhere in this codebase (event.photo.url in the poster
            renderer) — this is the interactive editor preview, not a
            page needing LCP tuning. */}
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" />
        ) : null}
      </div>

      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title} dir={lineDirection(track)}>{track || " "}</h1>
          <p className={styles.artist} dir={lineDirection(artist)}>{artist || " "}</p>
        </div>
        <svg className={styles.heart} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 20.5S3 14.8 3 8.9C3 5.6 5.5 3.4 8.3 3.4c1.8 0 3.3.9 4.2 2.3.9-1.4 2.4-2.3 4.2-2.3 2.8 0 5.3 2.2 5.3 5.5 0 5.9-9 11.6-9 11.6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </div>

      <div className={styles.progress} ref={progressRef} onClick={handleSeek}>
        {bars && (
          <svg className={styles.eq} viewBox="0 0 800 20" preserveAspectRatio="none" aria-hidden="true">
            {Array.from(bars).map((v, i) => {
              const barWidth = 800 / EQ_BARS;
              const height = Math.max(1.5, v * 18);
              const played = hasPlayback && i / EQ_BARS <= fraction;
              return (
                <rect
                  key={i}
                  x={(i * barWidth).toFixed(2)}
                  y={(20 - height).toFixed(2)}
                  width={(barWidth * 0.62).toFixed(2)}
                  height={height.toFixed(2)}
                  fill="currentColor"
                  opacity={played ? 0.92 : 0.32}
                />
              );
            })}
          </svg>
        )}
        <div className={styles.rule} />
        <div className={styles.fill} style={{ width: `${hasPlayback ? fillPercent : 0}%` }} />
        {hasPlayback && <div className={styles.knob} style={{ insetInlineStart: `${fillPercent}%` }} />}
        <span
          className={styles.elapsed}
          style={hasPlayback ? { insetInlineStart: `${fillPercent}%` } : { insetInlineStart: 0, transform: "none" }}
        >
          {formatTime(hasPlayback ? state.currentTime : 0)}
        </span>
        <span className={styles.duration}>{formatTime(state.duration)}</span>
      </div>

      <div className={styles.transport}>
        {/* Decorative — see the CSS module's own note: Player is one
            song, not a queue, so shuffle/prev/next have nothing real to
            do. Rendered inert rather than omitted, matching the
            prototype's chrome exactly. */}
        <svg className={`${styles.icon} ${styles.iconInert}`} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 6h6l3 4 3-4h6M3 18h6l3-4 3 4h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <svg className={`${styles.icon} ${styles.iconInert}`} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 5 8 12l9 7z" fill="currentColor" />
          <rect x="5" y="5" width="1.6" height="14" fill="currentColor" />
        </svg>

        {/*
          THE ONE REAL CONTROL. Everything else in this row is chrome;
          this button is what "start and stop button simulate real
          player" actually means — it toggles genuine playback in the
          invisible YouTube player behind it, and the icon swaps between
          play and pause based on the player's own reported state, not a
          locally-tracked guess that could drift from what is actually
          playing.
        */}
        <button
          type="button"
          className={styles.playButton}
          onClick={controls.toggle}
          disabled={!youtubeVideoId || !state.isReady}
          aria-label={state.isPlaying ? "Pause" : "Play"}
          aria-pressed={state.isPlaying}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="currentColor" />
            {state.isPlaying ? (
              <path d="M9 7.5h2v9H9zM13 7.5h2v9h-2z" fill="#f6f3ec" />
            ) : (
              <path d="M9.5 7.4v9.2l7.2-4.6z" fill="#f6f3ec" />
            )}
          </svg>
        </button>

        <svg className={`${styles.icon} ${styles.iconInert}`} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 5l9 7-9 7z" fill="currentColor" />
          <rect x="17.4" y="5" width="1.6" height="14" fill="currentColor" />
        </svg>
        <svg className={`${styles.icon} ${styles.iconInert}`} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 8h13l-2.5-2.5M20 16H7l2.5 2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className={styles.bottom}>
        {dedication && <p className={styles.message} dir={lineDirection(dedication)}>{dedication}</p>}
        {liveCodeSvg && <div className={styles.code}>{liveCodeSvg}</div>}
      </div>

      {state.error && (
        <p role="status" style={{ position: "absolute", insetInline: 60, bottom: 8, fontSize: 11, color: "#9b3220" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
