import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { getProductCaptures } from "@/lib/captures/manifest";
import { CaptureShowcase, type ShowcaseItem } from "./capture-showcase";

/**
 * The home hero's phone: the four loops in turn, product dots and a pause
 * button. It must cost nothing before it plays and never play for a visitor
 * who asked for less motion or is saving data.
 */

const items: ShowcaseItem[] = ["love-story-timeline", "reasons-i-love-you", "graduation-keepsake", "song-poster"].map((id) => ({
  id,
  name: id,
  captures: getProductCaptures(id, "en")!,
}));

let reducedMotion = false;
let saveData = false;
let intersect: ((visible: boolean) => void) | null = null;

beforeEach(() => {
  reducedMotion = false;
  saveData = false;
  intersect = null;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, "connection", { configurable: true, get: () => ({ saveData }) });
  window.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never);
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CaptureShowcase items={items} label="Keepsakes" />
    </NextIntlClientProvider>
  );

const videos = (container: HTMLElement) => [...container.querySelectorAll("video")];
const currentDot = () => screen.getAllByRole("button").find((button) => button.getAttribute("aria-current") === "true");

describe("CaptureShowcase", () => {
  it("before it is on screen: only the first still, loaded first, and no video", () => {
    const { container } = show();
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute("loading")).toBe("eager");
    expect(images[0]!.getAttribute("width")).toBe(String(items[0]!.captures.poster!.width));
    expect(videos(container)).toHaveLength(0);
  });

  it("on screen: one muted inline video, the current product's, and the next still waiting", () => {
    const { container } = show();
    act(() => intersect?.(true));
    const [video, ...others] = videos(container);
    expect(others).toHaveLength(0);
    expect(video!.getAttribute("src")).toBe(items[0]!.captures.loop!.src);
    expect(video!.muted).toBe(true);
    expect(video!.hasAttribute("playsinline")).toBe(true);
    expect(video!.getAttribute("preload")).toBe("none");
    expect(video!.loop).toBe(false);
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("moves to the next product when a loop ends, and back to the first after the last", () => {
    const { container } = show();
    act(() => intersect?.(true));
    for (let i = 1; i <= items.length; i++) {
      const playing = videos(container).find((video) => video.getAttribute("src") === items[(i - 1) % items.length]!.captures.loop!.src)!;
      fireEvent.ended(playing);
      expect(currentDot()).toHaveAccessibleName(items[i % items.length]!.name);
    }
    expect(videos(container)).toHaveLength(items.length);
  });

  it("a dot jumps to its product", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "song-poster" }));
    expect(currentDot()).toHaveAccessibleName("song-poster");
  });

  it("the pause button stops it, and play resumes", () => {
    const { container } = show();
    act(() => intersect?.(true));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    fireEvent.click(screen.getByRole("button", { name: en.Captures.pause }));
    expect(pause).toHaveBeenCalled();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    fireEvent.click(screen.getByRole("button", { name: en.Captures.play }));
    expect(play).toHaveBeenCalled();
    expect(videos(container)).toHaveLength(1);
  });

  it.each([
    ["reduced motion", () => (reducedMotion = true)],
    ["data saver", () => (saveData = true)],
  ])("with %s: stills only, no pause button, and the dots still change the still", (_name, set) => {
    set();
    const { container } = show();
    act(() => intersect?.(true));
    expect(videos(container)).toHaveLength(0);
    // Nothing fetched ahead either: the next still waits for a dot.
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: en.Captures.pause })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "graduation-keepsake" }));
    expect(currentDot()).toHaveAccessibleName("graduation-keepsake");
    expect(videos(container)).toHaveLength(0);
  });
});
