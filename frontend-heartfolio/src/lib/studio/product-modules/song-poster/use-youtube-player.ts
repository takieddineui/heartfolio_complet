"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadYouTubeIframeApi } from "./youtube-iframe-api";

/**
 * A hidden YouTube player, driven by a real transport UI instead of
 * YouTube's own chrome.
 *
 * WHY INVISIBLE RATHER THAN `display: none`. YouTube's own docs note the
 * iframe the API creates replaces the container element you give it —
 * nothing in the contract says a display:none container is safe, and
 * player-suspension-on-display:none is a widely reported real-world
 * failure mode for embedded iframes generally (autoplay/media policies
 * in several browsers pause media in elements not actually rendered).
 * The mount point here is a 1x1px, clipped, off-screen element — genuinely
 * rendered, so playback is never at the mercy of a browser's "is this
 * visible" heuristic, just invisible to the eye. Same idea as
 * screen-reader-only utility text: present and live, never display:none.
 *
 * SELF-CONTAINED ON PURPOSE. This hook does NOT return a ref for the
 * caller to attach to JSX — it creates its own detached `<div>` with
 * `document.createElement`, appends it straight to `document.body`, and
 * tears it down on cleanup. A ref threaded through the component tree is
 * one more thing a caller can wire up wrong (forget to render the mount
 * element, render it conditionally and lose it, etc.); a hook that
 * manages its whole side effect internally cannot be misused that way.
 *
 * WHY POLLING FOR `currentTime`. The IFrame API's events are discrete
 * state changes (`onStateChange` fires on play/pause/end/buffer), not a
 * continuous "time update" the way the HTML5 `<video>` element's
 * `timeupdate` event is — there is no equivalent to subscribe to.
 * Polling `getCurrentTime()` on an interval while playing is the
 * documented, standard way every real-world IFrame API integration
 * drives a progress bar; it is the actual mechanism, not a workaround.
 */
export interface YouTubePlayerState {
  isReady: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
}

export interface YouTubePlayerControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
}

const POLL_INTERVAL_MS = 250;

export function useYouTubePlayer(videoId: string | null): [YouTubePlayerState, YouTubePlayerControls] {
  const playerRef = useRef<YT.Player | null>(null);
  const mountElRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const boundVideoId = useRef<string | null>(null);

  const [state, setState] = useState<YouTubePlayerState>({
    isReady: false,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    error: null,
  });

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setState((prev) => ({ ...prev, currentTime: player.getCurrentTime() }));
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  useEffect(() => {
    if (!videoId) return;
    if (boundVideoId.current === videoId && playerRef.current) return;

    let cancelled = false;

    setState((prev) => ({ ...prev, isReady: false, error: null }));

    // The invisible mount point, created fresh for this player instance
    // rather than reused across video-id changes — the IFrame API takes
    // ownership of whatever element it is given and replaces its
    // contents, so a clean element per player avoids depending on the
    // API's own teardown/rebuild behaviour on the same node.
    const mountEl = document.createElement("div");
    mountEl.setAttribute("aria-hidden", "true");
    mountEl.style.position = "fixed";
    mountEl.style.width = "1px";
    mountEl.style.height = "1px";
    mountEl.style.overflow = "hidden";
    mountEl.style.insetInlineStart = "-9999px";
    mountEl.style.insetBlockStart = "-9999px";
    document.body.appendChild(mountEl);
    mountElRef.current = mountEl;

    loadYouTubeIframeApi()
      .then((YT_) => {
        if (cancelled) return;

        playerRef.current?.destroy();
        boundVideoId.current = videoId;

        playerRef.current = new YT_.Player(mountEl, {
          videoId,
          width: 1,
          height: 1,
          playerVars: {
            // `playsinline` — required on iOS Safari, or the video takes
            // over the whole screen the moment it plays, which utterly
            // defeats an "invisible player behind a custom UI" design.
            playsinline: 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              setState((prev) => ({
                ...prev,
                isReady: true,
                duration: event.target.getDuration(),
              }));
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const playing = event.data === YT_.PlayerState.PLAYING;
              setState((prev) => ({ ...prev, isPlaying: playing }));
              if (playing) startPolling();
              else stopPolling();
            },
            onError: () => {
              if (cancelled) return;
              // A specific numbered YT error code exists but is not
              // surfaced: by the time playback reaches this hook, the
              // video has already passed the Studio's own
              // `YouTubeValidateView` check, so a playback-time error is
              // the rarer case of the video having changed status since
              // — not something a customer can act on by reading a code.
              setState((prev) => ({ ...prev, error: "This video stopped being playable." }));
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, error: "Could not load the player." }));
      });

    return () => {
      cancelled = true;
    };
  }, [videoId, startPolling, stopPolling]);

  // Final teardown — separate from the effect above so it runs once on
  // unmount, not on every videoId change (which has its own destroy()
  // call already, immediately before building the replacement player).
  useEffect(() => {
    return () => {
      stopPolling();
      playerRef.current?.destroy();
      playerRef.current = null;
      boundVideoId.current = null;
      mountElRef.current?.remove();
      mountElRef.current = null;
    };
  }, [stopPolling]);

  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  const toggle = useCallback(() => {
    if (state.isPlaying) pause();
    else play();
  }, [state.isPlaying, play, pause]);
  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    // Reflected immediately rather than waiting for the next poll tick,
    // so dragging the visible progress knob does not lag behind the
    // finger/cursor by up to `POLL_INTERVAL_MS`.
    setState((prev) => ({ ...prev, currentTime: seconds }));
  }, []);

  return [state, { play, pause, toggle, seekTo }];
}
