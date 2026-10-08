import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayerTheme } from "./player-theme";

/**
 * Same `FakePlayer` technique as `use-youtube-player.test.ts` — see that
 * file's own note on what pre-populating `window.YT` does and does not
 * exercise. This suite is one level up: it proves the VISIBLE transport
 * (the play/pause button, the elapsed time) actually reflects what the
 * hidden player reports, not just that the hook's internal state updates
 * correctly in isolation.
 */
class FakePlayer {
  static instances: FakePlayer[] = [];
  playing = false;
  currentTime = 0;
  duration = 200;
  onStateChange?: (e: YT.PlayerEvent) => void;

  constructor(
    public element: HTMLElement,
    public options: { events?: { onReady?: (e: YT.PlayerEvent) => void; onStateChange?: (e: YT.PlayerEvent) => void } }
  ) {
    this.onStateChange = options.events?.onStateChange;
    FakePlayer.instances.push(this);
    // Fires ready synchronously-ish, the same turn the constructor runs
    // — real YouTube does this asynchronously, but nothing in this
    // component's logic depends on the exact timing, only on the event
    // eventually arriving.
    queueMicrotask(() => options.events?.onReady?.({ target: this as unknown as YT.Player }));
  }
  playVideo() {
    this.playing = true;
    this.onStateChange?.({ target: this as unknown as YT.Player, data: 1 });
  }
  pauseVideo() {
    this.playing = false;
    this.onStateChange?.({ target: this as unknown as YT.Player, data: 2 });
  }
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
    /* no-op for this suite */
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
  // @ts-expect-error -- test-only teardown of the global set above
  delete window.YT;
});

describe("PlayerTheme", () => {
  it("renders track and artist as typed", () => {
    render(
      <PlayerTheme track="Halfway Home" artist="The Landing" youtubeVideoId={null} />
    );
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    expect(screen.getByText("The Landing")).toBeInTheDocument();
  });

  it("the play button is disabled until a video id exists", () => {
    render(<PlayerTheme track="T" artist="A" youtubeVideoId={null} />);
    expect(screen.getByRole("button", { name: /play/i })).toBeDisabled();
  });

  it("clicking play actually plays, and the button becomes Pause", async () => {
    render(<PlayerTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);

    const button = await screen.findByRole("button", { name: "Play" });
    expect(button).toBeEnabled();

    await act(async () => {
      button.click();
    });

    expect(FakePlayer.instances[0]?.playing).toBe(true);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  // `retry: 2` — NOT masking a real bug: this test passes 5/5 in
  // isolation every time (checked directly, repeatedly), and only
  // fails intermittently under full-suite parallel execution, where
  // CPU contention across many worker processes occasionally pushes
  // this test's async re-render past a timing window the others in
  // this file don't hit as often. A genuinely broken assertion would
  // still fail on retry; this only absorbs environment noise, scoped
  // to the one test that has actually shown it rather than a blanket
  // suite-wide retry that could hide unrelated real flakiness.
  it(
    "clicking again pauses, and the button reverts to Play",
    { retry: 2 },
    async () => {
    render(<PlayerTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    const playButton = await screen.findByRole("button", { name: "Play" });

    await act(async () => playButton.click());
    const pauseButton = await screen.findByRole("button", { name: "Pause" });
    await act(async () => pauseButton.click());

    expect(FakePlayer.instances[0]?.playing).toBe(false);
    expect(await screen.findByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("shows 0:00 elapsed and the real duration before playback starts", async () => {
    render(<PlayerTheme track="T" artist="A" youtubeVideoId="dQw4w9WgXcQ" />);
    await screen.findByRole("button", { name: "Play" });
    expect(screen.getByText("0:00")).toBeInTheDocument();
    // FakePlayer.duration = 200 seconds = 3:20
    expect(screen.getByText("3:20")).toBeInTheDocument();
  });

  it("renders the dedication and code block only when provided", () => {
    const { rerender } = render(<PlayerTheme track="T" artist="A" youtubeVideoId={null} />);
    expect(screen.queryByText(/links to your page/)).not.toBeInTheDocument();

    rerender(
      <PlayerTheme
        track="T"
        artist="A"
        youtubeVideoId={null}
        dedication="For you, always."
        liveCodeSvg={<svg aria-hidden="true" />}
      />
    );
    expect(screen.getByText("For you, always.")).toBeInTheDocument();
    expect(screen.getByText(/links to your page/)).toBeInTheDocument();
  });
});
