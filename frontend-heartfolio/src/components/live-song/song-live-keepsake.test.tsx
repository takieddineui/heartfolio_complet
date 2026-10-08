import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SongLiveKeepsake } from "./song-live-keepsake";

/**
 * The SAME `FakePlayer` technique `player-theme.test.tsx` already
 * established for this exact hook (`useYouTubePlayer`) — reused, not
 * reinvented, so a real YouTube script is never required in jsdom and
 * both test suites exercise the hook the same way.
 */
class FakePlayer {
  playing = false;
  currentTime = 0;
  duration = 200;
  onStateChange?: (e: YT.PlayerEvent) => void;

  constructor(
    public element: HTMLElement,
    public options: { events?: { onReady?: (e: YT.PlayerEvent) => void; onStateChange?: (e: YT.PlayerEvent) => void } }
  ) {
    this.onStateChange = options.events?.onStateChange;
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
  window.YT = {
    Player: FakePlayer,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  };
});

afterEach(() => {
  // @ts-expect-error -- test-only teardown of the global set above
  delete window.YT;
});

const BASE_VALUES = {
  track: "Halfway Home",
  artist: "The Landing",
  youtubeVideoId: "dQw4w9WgXcQ",
};

describe("SongLiveKeepsake", () => {
  it("renders the real track and artist, not placeholder text", () => {
    render(<SongLiveKeepsake values={BASE_VALUES} />);
    expect(screen.getByText("Halfway Home")).toBeInTheDocument();
    expect(screen.getByText("The Landing")).toBeInTheDocument();
  });

  it("shows the dedication only when one is provided", () => {
    const { rerender } = render(<SongLiveKeepsake values={BASE_VALUES} />);
    expect(screen.queryByText("For you.")).not.toBeInTheDocument();

    rerender(<SongLiveKeepsake values={{ ...BASE_VALUES, dedication: "For you." }} />);
    expect(screen.getByText("For you.")).toBeInTheDocument();
  });

  it("shows the photo only when one is provided", () => {
    const { rerender, container } = render(<SongLiveKeepsake values={BASE_VALUES} />);
    expect(container.querySelector("img")).toBeNull();

    rerender(<SongLiveKeepsake values={{ ...BASE_VALUES, photo: { url: "https://example.com/p.jpg" } }} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/p.jpg");
  });

  it("the play button is disabled until a video id exists", () => {
    render(<SongLiveKeepsake values={{ ...BASE_VALUES, youtubeVideoId: null }} />);
    expect(screen.getByRole("button", { name: /play/i })).toBeDisabled();
  });

  it("clicking play actually plays — never autoplays on its own", async () => {
    render(<SongLiveKeepsake values={BASE_VALUES} />);

    const button = await screen.findByRole("button", { name: "Play" });
    expect(button).not.toBeDisabled();

    button.click();
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("renders a real, seeded waveform as an interactive seek slider", async () => {
    render(<SongLiveKeepsake values={BASE_VALUES} />);
    const slider = await screen.findByRole("slider", { name: "Seek" });
    expect(slider).toBeInTheDocument();
    expect(slider.querySelectorAll("rect").length).toBeGreaterThan(0);
  });
});
