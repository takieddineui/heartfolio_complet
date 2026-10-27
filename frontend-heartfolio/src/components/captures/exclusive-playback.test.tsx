import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { CaptureLoop } from "./capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";

/**
 * ONE LOOP AT A TIME on a guide (27 Oct 2026): loops sharing an `exclusive`
 * group take turns, the most recent to come on screen playing; when it
 * leaves, the previous one still on screen resumes. Loops outside a group are
 * unaffected (the home page's).
 */
const a = getProductCaptures("reasons-i-love-you", "en")!;
const b = getProductCaptures("song-poster", "en")!;

let observers: ((visible: boolean) => void)[] = [];
const playing = new Set<HTMLMediaElement>();

beforeEach(() => {
  observers = [];
  playing.clear();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, "connection", { configurable: true, get: () => ({ saveData: false }) });
  window.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      observers.push((visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never));
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    playing.add(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
  });
});

afterEach(() => vi.restoreAllMocks());

const show = (group?: string) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <div data-testid="a">
        <CaptureLoop captures={a} alt="" mode="inView" exclusive={group} />
      </div>
      <div data-testid="b">
        <CaptureLoop captures={b} alt="" mode="inView" exclusive={group} />
      </div>
    </NextIntlClientProvider>
  );

const videoIn = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"] video`) as HTMLVideoElement | null;
const playingIds = (container: HTMLElement) => ["a", "b"].filter((id) => videoIn(container, id) && playing.has(videoIn(container, id)!));

describe("exclusive playback", () => {
  it("plays the most recent loop to come on screen, pauses the other, and hands back when it leaves", () => {
    const { container } = show("guide");
    act(() => observers[0]!(true));
    expect(playingIds(container)).toEqual(["a"]);

    act(() => observers[1]!(true));
    expect(playingIds(container)).toEqual(["b"]);

    act(() => observers[1]!(false));
    expect(playingIds(container)).toEqual(["a"]);
  });

  it("the reader's pause on the playing loop gives the turn back too", () => {
    const { container, getAllByRole } = show("guide");
    act(() => observers[0]!(true));
    act(() => observers[1]!(true));
    // b's pause button (the second on the page).
    fireEvent.click(getAllByRole("button", { name: en.Captures.pause })[1]!);
    expect(playingIds(container)).toEqual(["a"]);
  });

  it("loops outside a group play together, as before", () => {
    const { container } = show(undefined);
    act(() => observers[0]!(true));
    act(() => observers[1]!(true));
    expect(playingIds(container).sort()).toEqual(["a", "b"]);
  });
});
