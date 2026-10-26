/**
 * Loads YouTube's IFrame Player API once, globally, and resolves when
 * `window.YT.Player` is actually usable.
 *
 * SAME CACHED-PROMISE SHAPE AS `paddle-client.ts`'s `getPaddle()`,
 * deliberately: this codebase already solved "load a third-party script
 * exactly once, however many components ask for it" for Paddle, and
 * there is no reason for a second pattern for YouTube. Repeated calls —
 * the Studio preview, the digital/live page, a future second Song
 * Poster theme — all share the one load.
 *
 * THE OFFICIAL CONTRACT, verified against Google's own IFrame Player API
 * reference rather than assumed from memory: a `<script src="https://
 * www.youtube.com/iframe_api">` tag is inserted, and the API calls a
 * GLOBAL function named exactly `window.onYouTubeIframeAPIReady` once it
 * has finished loading — not a callback passed to the script, not a
 * `load` event on the tag itself. That global-callback shape is why this
 * needs its own loader rather than a generic "inject a script tag and
 * await its onload" helper: onload would fire before `window.YT` exists.
 */

let apiPromise: Promise<typeof window.YT> | null = null;

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
  // Minimal shape of the global the IFrame API attaches — only the
  // surface this codebase actually calls, not the full reference.
  namespace YT {
    enum PlayerState {
      UNSTARTED = -1,
      ENDED = 0,
      PLAYING = 1,
      PAUSED = 2,
      BUFFERING = 3,
      CUED = 5,
    }
    interface PlayerEvent {
      target: Player;
      data?: number;
    }
    interface PlayerOptions {
      videoId: string;
      /** Where the player's iframe loads from; youtube-nocookie.com for the
       *  privacy-enhanced mode. */
      host?: string;
      width?: number | string;
      height?: number | string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: PlayerEvent) => void;
        onStateChange?: (event: PlayerEvent) => void;
        onError?: (event: PlayerEvent) => void;
      };
    }
    class Player {
      constructor(element: HTMLElement | string, options: PlayerOptions);
      playVideo(): void;
      pauseVideo(): void;
      stopVideo(): void;
      seekTo(seconds: number, allowSeekAhead: boolean): void;
      getCurrentTime(): number;
      getDuration(): number;
      getPlayerState(): PlayerState;
      destroy(): void;
    }
  }
}

export function loadYouTubeIframeApi(): Promise<typeof window.YT> {
  if (typeof window === "undefined") {
    // SSR/build-time guard. This module is only ever used from
    // `"use client"` components, but importing it must not itself throw
    // during a server render of the surrounding tree.
    return Promise.reject(new Error("YouTube IFrame API is browser-only."));
  }

  if (window.YT?.Player) {
    // Already loaded — a second theme, or a fast remount, asking again.
    return Promise.resolve(window.YT);
  }

  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        // Chain rather than overwrite: if something else on the page
        // ever also sets this global, both still run.
        previous?.();
        resolve(window.YT!);
      };

      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }

  return apiPromise;
}
