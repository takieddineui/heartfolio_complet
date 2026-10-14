import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false as boolean | null }));
// framer-motion caches the OS preference per module load, so the tests control
// the hook's VALUE (true, false, or null while unknown), as the live page's
// motion tests do.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motion.reduced,
}));

import { ReasonsLivePreview } from "@/lib/studio/product-modules/reasons-i-love-you/live-preview";
import { createInitialState } from "@/lib/studio/product-modules/reasons-i-love-you/initial-state";
import type { ReasonsExperienceData } from "./experience-data";
import { PHOTO_BOX, ReasonsKeepsake, writesLetterByLetter } from "./reasons-keepsake";
import { ReasonsLivePage } from "./reasons-live-page";
import { Sparkles } from "./sparkles";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = strip(readFileSync("src/components/live-reasons/reasons-keepsake.module.css", "utf8"));
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

const DATA: ReasonsExperienceData = {
  gift: "jar",
  toName: "Hana",
  fromName: "Theo",
  title: "",
  reasons: [
    { text: "Your laugh.", memory: "", photo: null },
    { text: "Ordinary Tuesdays.", memory: "Pancakes, March 2025.", photo: { url: "https://photos.test/2.jpg" } },
    { text: "Good morning, every day.", memory: "", photo: null },
  ],
  finaleTeaser: "",
  finaleLine: "You are you.",
  signature: "",
  letter: { greeting: "Hana,", paragraphs: ["First paragraph.", "Second paragraph."], signoff: "All my love," },
  music: true,
  share: true,
};

class FakeAudioContext {
  static created = 0;
  static closed = 0;
  state = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  constructor() {
    FakeAudioContext.created += 1;
  }
  private node = () => ({
    connect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    gain: { value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined },
    frequency: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
    type: "",
    buffer: null,
  });
  createGain = this.node;
  createOscillator = this.node;
  createBiquadFilter = this.node;
  createBufferSource = this.node;
  createBuffer = () => ({ getChannelData: () => new Float32Array(16) });
  resume = () => Promise.resolve();
  close = () => {
    FakeAudioContext.closed += 1;
    this.state = "closed";
    return Promise.resolve();
  };
}

const frameOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-gift]")!;
// Long enough for a card to arrive: it waits one animation frame (about 16ms
// in jsdom) before it is focused and animated.
const flush = async (ms = 20) => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
};
const tapJar = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Tap the jar" }));
  await flush();
};
const closeCard = async (container: HTMLElement) => {
  fireEvent.click(container.querySelector('[aria-hidden="false"]')!);
  await flush();
};

let burst: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  motion.reduced = false;
  FakeAudioContext.created = 0;
  FakeAudioContext.closed = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  burst = vi.spyOn(Sparkles.prototype, "burstAt");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the gift, opened one reason at a time", () => {
  it("shows the tag, the chosen gift and nothing that v1 leaves out", () => {
    const { container } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    expect(screen.getByText("For Hana")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3 reasons I love you" })).toBeTruthy();
    expect(screen.getByText("from Theo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tap the jar" })).toBeTruthy();
    // No gift switcher, no reply, no prototype notice.
    for (const name of ["Loves me, loves me", "A deck of hearts", "Fortune cookies", "Pick a petal", "Draw a card"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toMatch(/reply|prototype|replies/i);
  });

  it("opens the first reason, counts it and keeps it to read again", async () => {
    const { container } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    await tapJar();
    const card = screen.getByRole("dialog", { name: "Reason 1" });
    expect(within(card).getByText("Your laugh.")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    await closeCard(container);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reason 1" }));
    await flush();
    expect(within(screen.getByRole("dialog")).getByText("Your laugh.")).toBeTruthy();
  });

  it("after the last reason: the golden one, the finale with the signature, then the letter", async () => {
    const { container } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    for (let i = 0; i < 3; i++) {
      await tapJar();
      await closeCard(container);
    }
    expect(screen.getByText("A golden note is glowing at the bottom of the jar")).toBeTruthy();
    expect(container.querySelector('[data-part="special"]')).toBeTruthy();

    await tapJar();
    const finale = screen.getByRole("dialog", { name: "One more…" });
    expect(within(finale).getByText("You are you.")).toBeTruthy();
    // An empty signature signs with the sender's name, letter by letter.
    expect(finale.querySelector('[data-part="signature"]')?.textContent).toBe("Theo");
    expect(finale.querySelectorAll('[data-part="signature"] > span')).toHaveLength(4);

    const after = container.querySelector("section[hidden]");
    expect(after).toBeTruthy();
    await closeCard(container);
    expect(container.querySelector("section[hidden]")).toBeNull();
    expect(screen.getByText("Hana,")).toBeTruthy();
    expect(screen.getByText("Second paragraph.")).toBeTruthy();
  });

  it("reads again from the beginning", async () => {
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, reasons: [DATA.reasons[0]!] }} locale="en" />);
    await tapJar();
    await closeCard(container);
    await tapJar();
    await closeCard(container);
    fireEvent.click(screen.getByRole("button", { name: /Read it again/ }));
    await flush();
    expect(screen.getByText("0 of 1")).toBeTruthy();
    expect(screen.getByText("Tap the jar")).toBeTruthy();
  });
});

describe("reduced motion gates the scripted effects with its own check", () => {
  it("bursts sparkles when motion is allowed", async () => {
    render(<ReasonsKeepsake data={DATA} locale="en" />);
    await tapJar();
    expect(burst).toHaveBeenCalled();
  });

  it.each([
    ["reduced", true],
    ["not yet known", null],
  ])("bursts nothing when the preference is %s", async (_label, value) => {
    motion.reduced = value;
    render(<ReasonsKeepsake data={DATA} locale="en" />);
    await tapJar();
    expect(screen.getByRole("dialog", { name: "Reason 1" })).toBeTruthy();
    expect(burst).not.toHaveBeenCalled();
  });

  it("switches the looping animations off under reduced motion in the CSS too", () => {
    const block = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const selector of [".hint", ".stem", ".fold.gold", ".deckCard.queen", ".cookie.gold svg"]) expect(block).toContain(selector);
    expect(block).toMatch(/animation:\s*none/);
  });
});

describe("the music: generated live, never on its own, closed on leaving", () => {
  it("creates no audio until the first tap, then plays the gift's instrument", async () => {
    render(<ReasonsKeepsake data={DATA} locale="en" />);
    expect(FakeAudioContext.created).toBe(0);
    await tapJar();
    expect(FakeAudioContext.created).toBe(1);
  });

  it("never makes a sound when the sender switched music off, and shows no toggle", async () => {
    render(<ReasonsKeepsake data={{ ...DATA, music: false }} locale="en" />);
    expect(screen.queryByRole("button", { name: /Music/ })).toBeNull();
    await tapJar();
    expect(FakeAudioContext.created).toBe(0);
  });

  it("closes the audio when the page (or the Studio preview) goes away", async () => {
    const { unmount } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    await tapJar();
    unmount();
    expect(FakeAudioContext.closed).toBe(1);
  });

  it("uses no audio file and no upload", () => {
    const source = readFileSync("src/components/live-reasons/procedural-music.ts", "utf8");
    expect(source).not.toMatch(/new Audio\(|\.mp3|fetch\(/);
  });
});

describe("prototype scaffolding is gone", () => {
  it("writes nothing to browser storage while being read", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    await tapJar();
    await closeCard(container);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("has no tracking, reply, gift override, placeholder art or Google Fonts anywhere in its source", () => {
    const dir = "src/components/live-reasons";
    const source = readdirSync(dir)
      .filter((name) => !name.endsWith(".test.tsx"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n")
      // Comments may NAME what was removed; only code is checked.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of [/localStorage/, /sessionStorage/, /sendReply/, /\btrack\(/, /URLSearchParams/, /fonts\.googleapis/, /fonts\.gstatic/, /data:image\/svg/]) {
      expect(source).not.toMatch(pattern);
    }
  });
});

describe("everything stays inside its own frame", () => {
  it("puts the reveal card, the sparkle canvas and the toast inside the frame", async () => {
    const { container } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    await tapJar();
    const frame = frameOf(container);
    expect(frame.contains(screen.getByRole("dialog"))).toBe(true);
    expect(frame.contains(container.querySelector("canvas"))).toBe(true);
    expect(frame.contains(screen.getByRole("status"))).toBe(true);
  });

  it("positions nothing against the window, and makes the frame a containing block", () => {
    expect(CSS).not.toMatch(/position:\s*fixed/);
    expect(CSS).not.toMatch(/\b(100vh|100dvh|innerWidth)\b/);
    expect(rule(".frame")).toMatch(/contain:\s*layout paint/);
    expect(rule(".frame")).toMatch(/overflow:\s*hidden;[\s\S]*overflow:\s*clip/); // clip wins; hidden is the fallback
    for (const selector of [".reveal", ".fx", ".toast"]) expect(rule(selector), selector).toMatch(/position:\s*absolute/);
  });

  it("is the viewport's height on the live page and the pane's in the Studio", () => {
    expect(rule('.frame[data-fill="viewport"]')).toMatch(/height:\s*100svh/);
    expect(rule('.frame[data-fill="container"]')).toMatch(/height:\s*100%/);
  });
});

describe("right to left", () => {
  it("takes its language and direction from the ORDER's locale", () => {
    const { container } = render(<ReasonsKeepsake data={DATA} locale="ar" />);
    expect(frameOf(container).getAttribute("dir")).toBe("rtl");
    expect(frameOf(container).getAttribute("lang")).toBe("ar");
    expect(screen.getByRole("heading").textContent).toBe("٣ أسباب تجعلني أحبك");
    expect(screen.getByText("٠ من ٣")).toBeTruthy();
  });

  it("places corners and the tag's hole with logical properties, not left/right", () => {
    expect(rule(".tag::before")).toMatch(/inset-inline-start/);
    expect(rule(".cornerStart")).toMatch(/inset-inline-start/);
    expect(rule(".cornerEnd")).toMatch(/inset-inline-end/);
    for (const selector of [".tag::before", ".cornerStart", ".cornerEnd"]) expect(rule(selector)).not.toMatch(/(^|[\s;])(left|right):/);
  });
});

describe("a signature in a joining script", () => {
  it("stays one piece in Arabic, so its letters stay joined, and is still split in Latin", async () => {
    expect(writesLetterByLetter("Theo")).toBe(true);
    expect(writesLetterByLetter("ثيو")).toBe(false);

    const { container } = render(
      <ReasonsKeepsake data={{ ...DATA, reasons: [DATA.reasons[0]!], signature: "ثيو" }} locale="ar" />
    );
    fireEvent.click(screen.getByRole("button", { name: "المس الوعاء" }));
    await flush();
    await closeCard(container);
    fireEvent.click(screen.getByRole("button", { name: "المس الوعاء" }));
    await flush();
    const parts = container.querySelectorAll('[data-part="signature"] > span');
    expect(parts).toHaveLength(1);
    expect(parts[0]!.hasAttribute("data-joined")).toBe(true);
    expect(parts[0]!.textContent).toBe("ثيو");
  });
});

describe("server and browser render the same page", () => {
  it("rounds the jar's scattered note positions, so hydration matches on every engine", () => {
    const { container } = render(<ReasonsKeepsake data={DATA} locale="en" />);
    for (const fold of container.querySelectorAll<HTMLElement>('[data-part="fold"]')) {
      for (const value of [fold.style.bottom, fold.style.insetInlineStart]) {
        expect(value, value).toMatch(/^\d+(\.\d{1,2})?%$/);
      }
    }
  });
});

describe("photos, built for a phone", () => {
  it("are lazy, decode off the main thread, carry their box's size and stay uncropped", async () => {
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, reasons: [DATA.reasons[1]!] }} locale="en" />);
    expect(container.querySelector("img")).toBeNull(); // not in the page until opened
    await tapJar();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("width")).toBe(String(PHOTO_BOX.width));
    expect(img.getAttribute("height")).toBe(String(PHOTO_BOX.height));
    expect(rule(".photoBox")).toMatch(/aspect-ratio:\s*4 \/ 3/);
    expect(rule(".photo")).toMatch(/object-fit:\s*contain/);
  });

  it("report a failed load so the live page can fetch fresh links", async () => {
    const onPhotoError = vi.fn();
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, reasons: [DATA.reasons[1]!] }} locale="en" onPhotoError={onPhotoError} />);
    await tapJar();
    fireEvent.error(container.querySelector("img")!);
    expect(onPhotoError).toHaveBeenCalledWith(0);
  });
});

describe("the other three gifts", () => {
  it("daisy: places petals around the flower's centre (no fill-box, the prototype's bug)", () => {
    expect(rule(".petal")).not.toMatch(/transform-box/);
  });


  it("daisy: one petal per reason, picked with the keyboard too, each saying I love you", async () => {
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, gift: "daisy" }} locale="en" />);
    const petals = container.querySelectorAll('[data-part="petal"]');
    expect(petals).toHaveLength(3);
    fireEvent.keyDown(petals[1]!, { key: "Enter" });
    await flush();
    expect(within(screen.getByRole("dialog")).getByText("Ordinary Tuesdays.")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("Loves me…")).toBeTruthy();
  });

  it("deck: Ace to 10 of Hearts, and the chips say so", async () => {
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, gift: "deck" }} locale="en" />);
    expect(container.querySelectorAll('[data-part="card"]')).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Draw a card" }));
    await flush();
    await closeCard(container);
    expect(screen.getByRole("button", { name: "Reason 1" }).textContent).toBe("A♥");
    // Card notation stays left to right, even on an Arabic page.
    expect(screen.getByRole("button", { name: "Reason 1" }).getAttribute("dir")).toBe("ltr");
  });

  it("cookies: one per reason, each with its lucky numbers", async () => {
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, gift: "cookies" }} locale="en" />);
    expect(container.querySelectorAll('[data-part="cookie"]')).toHaveLength(3);
    fireEvent.click(container.querySelectorAll<HTMLElement>('[data-part="cookie"]')[2]!);
    await flush(50); // the crack pauses 200ms before the slip comes out
    expect(within(screen.getByRole("dialog")).getByText(/Lucky numbers: 3 · 3 · 18 · 38 · 14 · 2/)).toBeTruthy();
  });
});

describe("the same branding line as every other live page", () => {
  it("is exactly Love Story Timeline's and Song Poster's, always shown", () => {
    const line = "Made with Heartfolio · theheartfolio.com";
    expect(readFileSync("src/components/live/live-keepsake.tsx", "utf8")).toContain(line);
    expect(readFileSync("src/components/live-song/song-live-keepsake.tsx", "utf8")).toContain(line);
    const { container } = render(<ReasonsKeepsake data={DATA} locale="ar" />);
    expect(container.querySelector('a[href="https://theheartfolio.com"]')?.textContent).toBe(line);
  });
});

describe("in the Studio", () => {
  it("shows the share button inert, because there is no link before purchase", async () => {
    const { container } = render(<ReasonsKeepsake data={{ ...DATA, reasons: [DATA.reasons[0]!] }} locale="en" shareUrl={null} />);
    await tapJar();
    await closeCard(container);
    await tapJar();
    await closeCard(container);
    expect(screen.getByRole("button", { name: /Share/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("starts a newly chosen gift from the beginning", async () => {
    const values = createInitialState();
    const { rerender } = render(<ReasonsLivePreview values={values} themeSelections={{ gift: "jar" }} locale="en" />);
    await tapJar();
    expect(screen.getByText("1 of 5")).toBeTruthy();
    rerender(<ReasonsLivePreview values={values} themeSelections={{ gift: "deck" }} locale="en" />);
    expect(screen.getByText("0 of 5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draw a card" })).toBeTruthy();
  });
});

describe("on the live page, an expired photo link is renewed", () => {
  it("asks the backend once for fresh links (no trailing slash) and swaps them in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ values: { reasons: [{ photo: { url: "https://photos.test/fresh.jpg" } }] } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ReasonsLivePage liveId="abc 1" initial={{ ...DATA, reasons: [DATA.reasons[1]!] }} locale="en" />);
    await tapJar();
    fireEvent.error(container.querySelector("img")!);
    fireEvent.error(container.querySelector("img")!);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/backend/live/abc%201");
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://photos.test/fresh.jpg");
  });
});
