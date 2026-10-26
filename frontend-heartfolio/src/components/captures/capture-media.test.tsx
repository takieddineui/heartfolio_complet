import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { CaptureLoop } from "./capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";

/**
 * The storefront's loops must cost nothing until they play, and never play
 * for a visitor who asked for less motion or is saving data: the <video>
 * element (and so its request) must not exist then. A loop that plays by
 * itself must be pausable (WCAG 2.2.2), and every video must be muted and
 * inline so iPhones play it in place.
 */

const captures = getProductCaptures("love-story-timeline", "en")!;

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

const show = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  );

describe("CaptureLoop", () => {
  it("always shows the still, sized so nothing shifts when it loads", () => {
    const { container } = show(<CaptureLoop captures={captures} alt="A sample" mode="hover" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("width")).toBe(String(captures.poster!.width));
    expect(img.getAttribute("height")).toBe(String(captures.poster!.height));
    expect(container.querySelector("source[type='image/avif']")).not.toBeNull();
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("on a card, creates no video until the card is hovered, then a muted inline loop", () => {
    const { container, rerender } = show(<CaptureLoop captures={captures} alt="" mode="hover" active={false} />);
    expect(container.querySelector("video")).toBeNull();
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <CaptureLoop captures={captures} alt="" mode="hover" active />
      </NextIntlClientProvider>
    );
    const video = container.querySelector("video")!;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.getAttribute("src")).toBe(captures.loop!.src);
  });

  it.each([
    ["reduced motion", () => (reducedMotion = true)],
    ["data saver", () => (saveData = true)],
  ])("with %s, never creates a video, hovered or on screen", (_name, set) => {
    set();
    const { container } = show(
      <>
        <CaptureLoop captures={captures} alt="" mode="hover" active />
        <CaptureLoop captures={captures} alt="" mode="inView" />
      </>
    );
    act(() => intersect?.(true));
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("on a page, plays only while on screen, and its pause button stops it", () => {
    const { container } = show(<CaptureLoop captures={captures} alt="" mode="inView" priority />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")!.getAttribute("loading")).toBe("eager");

    act(() => intersect?.(true));
    expect(container.querySelector("video")).not.toBeNull();

    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    fireEvent.click(screen.getByRole("button", { name: en.Captures.pause }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: en.Captures.play })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: en.Captures.play }));
    pause.mockClear();
    act(() => intersect?.(false));
    expect(pause).toHaveBeenCalled();
  });

  it("waits for the page to finish loading before any video", () => {
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const { container } = show(<CaptureLoop captures={captures} alt="" mode="hover" active />);
    expect(container.querySelector("video")).toBeNull();
    readyState.mockReturnValue("complete");
    act(() => {
      window.dispatchEvent(new Event("load"));
    });
    expect(container.querySelector("video")).not.toBeNull();
  });
});
