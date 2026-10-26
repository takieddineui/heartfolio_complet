import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useYouTubePlayer } from "./use-youtube-player";

/**
 * `window.YT` is pre-populated with a fake `Player` BEFORE the hook
 * renders, rather than simulating the real `<script>` tag load. This is
 * not a shortcut around testing the loader — it exercises the loader's
 * OWN documented fast path (`loadYouTubeIframeApi` returns immediately
 * when `window.YT?.Player` already exists), which is exactly what
 * happens for every player after the first one on a page with two Song
 * Poster surfaces open (Studio preview + digital view). What this
 * cannot exercise is the actual network load of the real script — jsdom
 * has no path to youtube.com from this sandbox, same limitation as the
 * oEmbed check on the backend.
 */

class FakePlayer {
  static instances: FakePlayer[] = [];

  destroyed = false;
  playing = false;
  currentTime = 0;
  duration = 212;
  onReady?: (e: YT.PlayerEvent) => void;
  onStateChange?: (e: YT.PlayerEvent) => void;

  constructor(
    public element: HTMLElement,
    public options: {
      host?: string;
      events?: {
        onReady?: (e: YT.PlayerEvent) => void;
        onStateChange?: (e: YT.PlayerEvent) => void;
      };
    }
  ) {
    this.onReady = options.events?.onReady;
    this.onStateChange = options.events?.onStateChange;
    FakePlayer.instances.push(this);
  }

  playVideo() {
    this.playing = true;
    this.onStateChange?.({ target: this as unknown as YT.Player, data: 1 /* YT.PlayerState.PLAYING */ });
  }
  pauseVideo() {
    this.playing = false;
    this.onStateChange?.({ target: this as unknown as YT.Player, data: 2 /* YT.PlayerState.PAUSED */ });
  }
  // Present only to satisfy the real `YT.Player` shape the hook is typed
  // against — nothing in this suite calls either, so they are inert
  // rather than tracking state a test never asserts on.
  stopVideo() {
    this.playing = false;
  }
  getPlayerState() {
    return this.playing ? 1 : 2;
  }
  seekTo(seconds: number) {
    this.currentTime = seconds;
  }
  getCurrentTime() {
    return this.currentTime;
  }
  getDuration() {
    return this.duration;
  }
  destroy() {
    this.destroyed = true;
  }
}

beforeEach(() => {
  FakePlayer.instances = [];
  window.YT = {
    Player: FakePlayer,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  };
});

afterEach(() => {
  // @ts-expect-error -- undo the test double so it never leaks between files
  delete window.YT;
  vi.restoreAllMocks();
});

describe("useYouTubePlayer", () => {
  it("does nothing until a videoId is provided", () => {
    const { result } = renderHook(() => useYouTubePlayer(null));
    const [state] = result.current;
    expect(state.isReady).toBe(false);
    expect(FakePlayer.instances).toHaveLength(0);
  });

  it("constructs a player against the hidden mount, not any visible element", async () => {
    renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));

    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));
    const player = FakePlayer.instances[0]!;

    // The mount is a real, rendered element — not display:none — sized
    // to be invisible rather than absent. See the hook's own docstring
    // for why that distinction matters for playback continuing at all.
    expect(player.element.style.width).toBe("1px");
    expect(player.element.style.height).toBe("1px");
    expect(player.element.style.display).not.toBe("none");
    expect(document.body.contains(player.element)).toBe(true);
  });

  it("loads the player from youtube-nocookie.com, the privacy-enhanced mode", async () => {
    // The privacy page promises it (26 Oct 2026). Without `host`, the IFrame
    // API builds the iframe on www.youtube.com.
    renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));

    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));
    expect(FakePlayer.instances[0]!.options.host).toBe("https://www.youtube-nocookie.com");
  });

  it("reports isReady and duration once the player fires onReady", async () => {
    const { result } = renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));
    const player = FakePlayer.instances[0]!;

    act(() => player.onReady?.({ target: player as unknown as YT.Player }));

    expect(result.current[0].isReady).toBe(true);
    expect(result.current[0].duration).toBe(212);
  });

  it("play() and pause() flip isPlaying, driven by the player's own state-change event", async () => {
    const { result } = renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));

    act(() => result.current[1].play());
    expect(result.current[0].isPlaying).toBe(true);

    act(() => result.current[1].pause());
    expect(result.current[0].isPlaying).toBe(false);
  });

  it("toggle() plays when paused and pauses when playing", async () => {
    const { result } = renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));

    act(() => result.current[1].toggle());
    expect(result.current[0].isPlaying).toBe(true);

    act(() => result.current[1].toggle());
    expect(result.current[0].isPlaying).toBe(false);
  });

  it("seekTo() updates currentTime immediately, not on the next poll tick", async () => {
    const { result } = renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));

    act(() => result.current[1].seekTo(90));
    expect(result.current[0].currentTime).toBe(90);
  });

  it("destroys the player and removes its mount element on unmount", async () => {
    const { unmount } = renderHook(() => useYouTubePlayer("dQw4w9WgXcQ"));
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));
    const player = FakePlayer.instances[0]!;
    const mountEl = player.element;

    unmount();

    expect(player.destroyed).toBe(true);
    expect(document.body.contains(mountEl)).toBe(false);
  });

  it("tears down the old player and builds a fresh one when videoId changes", async () => {
    const { result, rerender } = renderHook(({ id }) => useYouTubePlayer(id), {
      initialProps: { id: "firstVideoId" },
    });
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(1));
    const first = FakePlayer.instances[0]!;

    rerender({ id: "secondVideoId" });
    await waitFor(() => expect(FakePlayer.instances).toHaveLength(2));

    expect(first.destroyed).toBe(true);
    expect(FakePlayer.instances[1]!.options).toBeDefined();
    void result;
  });
});
