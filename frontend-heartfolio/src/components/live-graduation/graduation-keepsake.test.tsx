import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: true as boolean | null }));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motion.reduced,
}));

import type { JourneyId } from "@/lib/studio/product-modules/graduation-keepsake/journeys";
import { GraduationLivePreview } from "@/lib/studio/product-modules/graduation-keepsake/live-preview";
import { createInitialState } from "@/lib/studio/product-modules/graduation-keepsake/initial-state";
import type { ExperiencePerson, GraduationExperienceData } from "./experience-data";
import { GraduationKeepsake } from "./graduation-keepsake";
import { GraduationLivePage } from "./graduation-live-page";
import { Confetti } from "./particles";

/**
 * GRADUATION KEEPSAKE: the five journeys, the prototype's bugs fixed, and the
 * rules every live page keeps (inside its own frame, reduced motion, right to
 * left, nothing left over from the prototype's scaffolding).
 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = strip(readFileSync("src/components/live-graduation/graduation-keepsake.module.css", "utf8"));
const SOURCES = readdirSync("src/components/live-graduation")
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .map((f) => [f, readFileSync(join("src/components/live-graduation", f), "utf8")] as const);

const person = (name: string, over: Partial<ExperiencePerson> = {}): ExperiencePerson => ({
  name,
  color: "",
  emoji: "🙂",
  message: `A message from ${name}.`,
  voice: null,
  voiceCaption: "",
  drawing: null,
  ...over,
});

const data = (journey: JourneyId, over: Partial<GraduationExperienceData> = {}): GraduationExperienceData => ({
  journey,
  grad: { name: "Maya", fullName: "Maya Chen", year: "2031", degree: "BA Architecture", school: "Edinburgh", date: "2031-07-02", photo: { url: "https://photos.test/maya.jpg" } },
  path: {
    then: { year: "2009", text: "Drew on every wall.", photo: { url: "https://photos.test/then.jpg" } },
    stops: [
      { year: "2014", caption: "School", code: "SCH", photo: { url: "https://photos.test/1.jpg" } },
      { year: "2018", caption: "Art prize", code: "", photo: { url: "https://photos.test/2.jpg" } },
      { year: "2024", caption: "Studio", code: "UNI", photo: { url: "https://photos.test/3.jpg" } },
    ],
    now: { year: "2031", text: "An architect." },
    next: { text: "Copenhagen.", photo: { url: "https://photos.test/next.jpg" } },
  },
  achievements: [
    { title: "First-class honours", detail: "Top of the year", place: "EDINBURGH" },
    { title: "Dean's list", detail: "", place: "" },
  ],
  messages: [
    { label: "From home", people: [person("Mum", { voice: { url: "https://audio.test/mum.m4a" }, voiceCaption: "My clever girl." }), person("Dad")] },
  ],
  goals: [{ text: "Copenhagen", code: "CPH" }],
  letter: { greeting: "Dear Maya,", paragraphs: ["We are proud."], signoff: "Love,", signatures: ["Mum", "Dad"] },
  ending: { line: "Congratulations, Maya!", sub: "Your next chapter starts now." },
  flight: { airline: "", number: "", seat: "", cabin: "", fromCode: "LDN", fromCity: "London", toCode: "CPH", toCity: "Copenhagen" },
  sound: true,
  share: true,
  ...over,
});

class FakeAudioContext {
  static created = 0;
  /** Every tone played: the typing ticks are tones. */
  static tones = 0;
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  constructor() {
    FakeAudioContext.created += 1;
  }
  private node = () => ({
    connect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
    frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
    type: "",
    buffer: null,
    loop: false,
  });
  createGain = this.node;
  createOscillator = () => {
    FakeAudioContext.tones += 1;
    return this.node();
  };
  createBiquadFilter = this.node;
  createBufferSource = this.node;
  createBuffer = () => ({ getChannelData: () => new Float32Array(16) });
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
}

/** The one `Audio` the keepsake creates for voice messages. */
let audios: HTMLAudioElement[] = [];
const RealAudio = globalThis.Audio;
const flush = async (ms = 20, rounds = 6) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
};
const frameOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-j]")!;
const begin = async (container: HTMLElement) => {
  const start = container.querySelector<HTMLElement>("section[class*='start']")!;
  fireEvent.click(start.querySelector("button")!);
  await flush(30, 10);
};
let burst: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  motion.reduced = true;
  FakeAudioContext.created = 0;
  FakeAudioContext.tones = 0;
  audios = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "Audio",
    class extends RealAudio {
      constructor() {
        super();
        audios.push(this);
      }
    }
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  burst = vi.spyOn(Confetti.prototype, "burstAt");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("each journey opens, then tells the story", () => {
  it.each(["airline", "space", "arcade", "museum", "summit"] as const)("%s: its own opening, then the page", async (j) => {
    const { container } = render(<GraduationKeepsake data={data(j)} locale="en" />);
    expect(frameOf(container).dataset.screen).toBe("start");
    await begin(container);
    expect(frameOf(container).dataset.screen).toBe("page");
    expect(container.querySelector("#gk-path")).not.toBeNull();
    expect(container.textContent).toContain("Congratulations, Maya!");
  });

  it("creates no sound until the first tap, and none at all when the creator switched sound off", async () => {
    const { container } = render(<GraduationKeepsake data={data("space")} locale="en" />);
    expect(FakeAudioContext.created).toBe(0);
    await begin(container);
    expect(FakeAudioContext.created).toBe(1);
    const quiet = render(<GraduationKeepsake data={data("space", { sound: false })} locale="en" />);
    await begin(quiet.container);
    expect(FakeAudioContext.created).toBe(1);
    expect(quiet.container.textContent).not.toContain("Sound on");
  });
});

describe("the path's labels (prototype bugs 3, 4, 5 and 6)", () => {
  const tags = async (j: JourneyId) => {
    const { container } = render(<GraduationKeepsake data={data(j)} locale="en" />);
    await begin(container);
    return [...container.querySelectorAll("#gk-path p b")].map((b) => b.textContent);
  };

  it("space: Now is the stage after the last stop, not Stage 1 again", async () => {
    expect(await tags("space")).toEqual(["T-0", "Stage 1", "Stage 2", "Stage 3", "Stage 4", "Next"]);
  });

  it("arcade: the stages count on to Now", async () => {
    expect(await tags("arcade")).toEqual(["World 1", "2-1", "3-1", "4-1", "5-1", "New game +"]);
  });

  it("summit: base camp climbs to the summit at the top", async () => {
    expect(await tags("summit")).toEqual(["0 m", "1,200 m", "2,400 m", "3,600 m", "4,808 m", "Next peak"]);
  });

  it("airline: Departure and Destination are the creator's own codes", async () => {
    expect(await tags("airline")).toEqual(["LDN", "SCH", "", "UNI", "GRD", "CPH"]);
  });
});

describe("the airline's postcards", () => {
  it("turn over, show the voice message beside the card (not inside it) with its caption (bugs 2 and 12)", async () => {
    const { container } = render(<GraduationKeepsake data={data("airline")} locale="en" />);
    await begin(container);
    const card = within(container.querySelector("#gk-messages")!).getByRole("button", { name: "Greetings from Mum" });
    fireEvent.click(card);
    await flush();
    const play = screen.getByRole("button", { name: "Play voice message: Mum" });
    expect(card.contains(play)).toBe(false);
    expect(container.textContent).toContain("“My clever girl.”");
    expect(container.querySelectorAll("button button, button [role='button']")).toHaveLength(0);
  });
});

describe("voice messages play to the end of the recording (prototype bug 1)", () => {
  it("is still playing at 11 seconds of a minute-long message, and stops only when it ends", async () => {
    const { container } = render(<GraduationKeepsake data={data("arcade")} locale="en" />);
    await begin(container);
    fireEvent.click(screen.getByRole("button", { name: "Message from Mum" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Play voice message: Mum" }));
    const audio = audios[0]!;
    expect(audio.src).toBe("https://audio.test/mum.m4a");
    Object.defineProperty(audio, "duration", { value: 60, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 11, configurable: true });
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });
    expect(screen.getByRole("button", { name: "Pause voice message: Mum" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });
    expect(screen.getByRole("button", { name: "Play voice message: Mum" })).toHaveAttribute("aria-pressed", "false");
  });

  it("the museum's audio guide starts inside the tap that opens it (what iOS allows)", async () => {
    const { container } = render(<GraduationKeepsake data={data("museum")} locale="en" />);
    await begin(container);
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Message from Mum" }));
    // Synchronously, in the same click: no timer in between.
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Message from Dad" }) ?? document.body);
  });

  it("an expired voice link asks the page for fresh links", async () => {
    const onMediaError = vi.fn();
    const { container } = render(<GraduationKeepsake data={data("arcade")} locale="en" onMediaError={onMediaError} />);
    await begin(container);
    fireEvent.click(screen.getByRole("button", { name: "Message from Mum" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Play voice message: Mum" }));
    act(() => {
      audios[0]!.dispatchEvent(new Event("error"));
    });
    expect(onMediaError).toHaveBeenCalledTimes(1);
  });
});

describe("messages that type themselves", () => {
  it("stop typing when their sheet closes, and start over when reopened", async () => {
    motion.reduced = false;
    const { container } = render(<GraduationKeepsake data={data("arcade", { messages: [{ label: "Home", people: [person("Mum", { message: "x".repeat(200) })] }] })} locale="en" />);
    await begin(container);
    await flush(200, 15);
    fireEvent.click(screen.getByRole("button", { name: "Message from Mum" }));
    await flush(40, 3);
    const typed = screen.getByRole("dialog").querySelector("p")!.textContent!.length;
    expect(typed).toBeGreaterThan(0);
    expect(typed).toBeLessThan(200);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flush(10, 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing keeps typing (or ticking) behind a closed sheet: the prototype did.
    const tonesAtClose = FakeAudioContext.tones;
    await flush(40, 4);
    expect(FakeAudioContext.tones).toBe(tonesAtClose);
    fireEvent.click(screen.getByRole("button", { name: "Message from Mum" }));
    await flush(10, 1);
    expect(screen.getByRole("dialog").querySelector("p")!.textContent!.length).toBeLessThan(typed);
  });
});

describe("achievements", () => {
  it("two tiles tapped before a re-render both count", async () => {
    const { container } = render(<GraduationKeepsake data={data("airline")} locale="en" />);
    await begin(container);
    const tiles = [...container.querySelectorAll<HTMLButtonElement>("#gk-achievements button")];
    act(() => {
      tiles.forEach((tile) => tile.click());
    });
    await flush();
    expect(container.querySelector("#gk-achievements [aria-live]")!.textContent).toBe("2 of 2 stamped");
  });
});

describe("reduced motion gates every scripted effect", () => {
  it("bursts confetti when motion is allowed", async () => {
    motion.reduced = false;
    const { container } = render(<GraduationKeepsake data={data("airline")} locale="en" />);
    await begin(container);
    await flush(200, 12);
    [...container.querySelectorAll<HTMLButtonElement>("#gk-achievements button")].forEach((tile) => fireEvent.click(tile));
    await flush(100, 6);
    expect(burst).toHaveBeenCalled();
  });

  it.each([true, null])("fires none at all when reduced (or not yet known: %s)", async (value) => {
    motion.reduced = value;
    const { container } = render(<GraduationKeepsake data={data("airline")} locale="en" />);
    await begin(container);
    [...container.querySelectorAll<HTMLButtonElement>("#gk-achievements button")].forEach((tile) => fireEvent.click(tile));
    await flush(100, 6);
    expect(burst).not.toHaveBeenCalled();
  });
});

describe("the one scroll listener is on the keepsake's own scroller", () => {
  it("never on the window", async () => {
    const windowAdd = vi.spyOn(window, "addEventListener");
    const elementAdd = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const { container } = render(<GraduationKeepsake data={data("summit")} locale="en" />);
    await begin(container);
    expect(windowAdd.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
    const scroller = container.querySelector("[class*='scroller']");
    const onScroller = elementAdd.mock.calls.filter(([type], i) => type === "scroll" && elementAdd.mock.contexts[i] === scroller);
    expect(onScroller).toHaveLength(1);
    expect(onScroller[0]![2]).toMatchObject({ passive: true });
  });

  it("updates at most once per frame (the handler only schedules)", () => {
    const source = SOURCES.find(([f]) => f === "graduation-keepsake.tsx")![1];
    expect(source).toMatch(/const schedule = \(\) => \{\s*if \(!raf\) raf = requestAnimationFrame\(update\);/);
  });
});

describe("everything stays inside its own frame (it is also the Studio's preview)", () => {
  it("positions nothing against the window and styles neither <html> nor <body>", () => {
    expect(CSS).not.toMatch(/position:\s*fixed/);
    expect(CSS).not.toMatch(/(^|[\s,}])(html|body|:root)[\s[{.:]/m);
    for (const [file, source] of SOURCES) {
      expect(source, file).not.toMatch(/document\.(documentElement|body)\.|theme-color/);
    }
  });

  it("sizes against the frame, not the window: no vw/vh except the live page's own height", () => {
    const units = CSS.match(/\d(?:vw|vh|svh|dvh)\b/g) ?? [];
    expect(units).toEqual(["0svh"]);
    expect(CSS).toMatch(/\.frame\[data-fill="viewport"\]\s*\{\s*height:\s*100svh;/);
  });

  it("is a containing block that clips, so nothing can leave it", () => {
    const frame = CSS.match(/\n\.frame \{([^}]*)\}/)![1]!;
    expect(frame).toMatch(/contain:\s*layout paint/);
    expect(frame).toMatch(/overflow:\s*clip/);
    expect(frame).toMatch(/container-type:\s*size/);
  });

  it("renders its sheet, lightbox, confetti and toast inside the frame", async () => {
    const { container } = render(<GraduationKeepsake data={data("arcade")} locale="en" />);
    await begin(container);
    fireEvent.click(screen.getByRole("button", { name: "Message from Mum" }));
    await flush();
    const frame = frameOf(container);
    expect(frame.contains(screen.getByRole("dialog"))).toBe(true);
    expect(frame.contains(container.querySelector("canvas"))).toBe(true);
    expect(frame.contains(screen.getByRole("status"))).toBe(true);
  });
});

describe("right to left", () => {
  it("takes its language and direction from the order's locale, with Arabic-Indic digits", async () => {
    const { container } = render(<GraduationKeepsake data={data("summit")} locale="ar" />);
    expect(frameOf(container)).toHaveAttribute("dir", "rtl");
    expect(frameOf(container)).toHaveAttribute("lang", "ar");
    await begin(container);
    const tags = [...container.querySelectorAll("#gk-path p b")].map((b) => b.textContent);
    expect(tags[tags.length - 2]).toBe("٤٬٨٠٨ م");
  });

  it("uses logical directions on the path, not left/right (prototype bug 10)", () => {
    for (const selector of [".path ", ".pathLine ", ".mover ", ".stop::before "]) {
      const body = CSS.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`))![1]!;
      expect(body, selector).not.toMatch(/(^|[\s;])(left|right|padding-left|border-left):/);
    }
  });

  it("lets what the creator wrote take its own direction", () => {
    expect(CSS).toMatch(/\.ut \{ unicode-bidi: plaintext; \}/);
  });
});

describe("prototype content and scaffolding are gone (prototype bug 11)", () => {
  it("no Maya-only copy, reply, tracking, storage, journey switcher or Google Fonts", () => {
    // Code only: the comments explain what was removed, by name.
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [file, source] of SOURCES) {
      expect(code(source), file).not.toMatch(/toast and talent|sendReply|reply\.reactions|data-act="react"|localStorage|sessionStorage|API\.track|\?journey=|googleapis|gstatic/);
    }
    expect(CSS).not.toMatch(/googleapis|gstatic/);
  });

  it("the museum's label is generic: the graduate's own years", async () => {
    const { container } = render(<GraduationKeepsake data={data("museum")} locale="en" />);
    await begin(container);
    expect(container.textContent).toContain("Mixed media, 2009–2031");
  });

  it("keeps the same branding line as every live page", () => {
    const source = SOURCES.find(([f]) => f === "graduation-keepsake.tsx")![1];
    expect(source).toContain('<a href="https://theheartfolio.com" tabIndex={done ? 0 : -1}>Made with Heartfolio · theheartfolio.com</a>');
  });
});

describe("photos are lazy, decode off the main thread and report a failure", () => {
  it("carry loading, decoding and a size hint", async () => {
    const { container } = render(<GraduationKeepsake data={data("airline")} locale="en" />);
    await begin(container);
    const stop = container.querySelector<HTMLImageElement>("#gk-path img[src='https://photos.test/1.jpg']")!;
    expect(stop).toHaveAttribute("loading", "lazy");
    expect(stop).toHaveAttribute("decoding", "async");
    expect(stop).toHaveAttribute("width");
  });

  it("a photo that already failed before React was listening still reports it", async () => {
    // The hero is in the server's HTML: its load can fail before hydration.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    const onMediaError = vi.fn();
    render(<GraduationKeepsake data={data("airline")} locale="en" onMediaError={onMediaError} />);
    await flush();
    expect(onMediaError).toHaveBeenCalled();
  });
});

describe("the purchased page asks for fresh links when one fails", () => {
  it("fetches the payload again and swaps the links in, at most once every 20 seconds", async () => {
    const fresh = data("airline", { grad: { ...data("airline").grad, photo: { url: "https://photos.test/fresh.jpg" } } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ values: fresh }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<GraduationLivePage liveId="abc" initial={data("airline")} locale="en" />);
    const hero = () => container.querySelector<HTMLImageElement>("header img")!;
    fireEvent.error(hero());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/live\/abc$/);
    expect(hero().getAttribute("src")).toBe("https://photos.test/fresh.jpg");
    fireEvent.error(hero());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("in the Studio", () => {
  it("previews the form, and starts a newly chosen journey from its opening", async () => {
    const values = createInitialState();
    const { container, rerender } = render(<GraduationLivePreview values={values} themeSelections={{ journey: "airline" }} locale="en" />);
    await begin(container);
    expect(frameOf(container).dataset.screen).toBe("page");
    rerender(<GraduationLivePreview values={values} themeSelections={{ journey: "space" }} locale="en" />);
    expect(frameOf(container).dataset.j).toBe("space");
    expect(frameOf(container).dataset.screen).toBe("start");
    expect(frameOf(container)).toHaveAttribute("data-fill", "container");
  });
});

describe("layout fixes found in a real browser at the spec's limits (pinned, since jsdom has no layout)", () => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = (selector: string) => CSS.match(new RegExp(`\\n${escape(selector)} \\{([^}]*)\\}`))?.[1] ?? "";

  it("a turned postcard grows to its message: the back face does not hide its overflow (bug 7)", () => {
    expect(body(".pcBack")).toMatch(/overflow:\s*visible/);
    expect(body(".pc")).toMatch(/aspect-ratio:\s*3\/2/);
  });

  it("a stamp waiting to be revealed cannot widen the page", () => {
    expect(body(".achs")).toMatch(/overflow-x:\s*clip/);
  });

  it("a long voice caption wraps inside its column", () => {
    expect(body(".vmeta")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(body(".item")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("the start screen scrolls when its content is taller than the phone (bug 14)", () => {
    expect(body(".start")).toMatch(/overflow-y:\s*auto/);
    expect(CSS).toMatch(/@container keepsake \(max-height: 640px\)/);
  });

  it("the arcade's banner is invisible while hidden, and only the arcade has one", async () => {
    expect(CSS).toMatch(/\.unlock:not\(\.unlockShow\) \{ visibility: hidden;/);
    const { container } = render(<GraduationKeepsake data={data("airline")} locale="en" />);
    expect(container.querySelector("[class*='unlock']")).toBeNull();
  });
});

describe("space: press and hold to launch", () => {
  const holdButton = () => screen.getByRole("button", { name: "Hold to launch" });

  it("a short hold, released, does not launch", async () => {
    const { container } = render(<GraduationKeepsake data={data("space")} locale="en" />);
    await begin(container);
    fireEvent.pointerDown(holdButton(), { pointerId: 1 });
    await flush(20, 2);
    fireEvent.pointerUp(holdButton(), { pointerId: 1 });
    await flush(100, 4);
    expect(container.querySelector("[class*='finDone']")).toBeNull();
  });

  it("a full hold launches", async () => {
    const { container } = render(<GraduationKeepsake data={data("space")} locale="en" />);
    await begin(container);
    fireEvent.pointerDown(holdButton(), { pointerId: 1 });
    await flush(100, 8);
    expect(container.querySelector("[class*='finDone']")).not.toBeNull();
  });

  it("Enter launches straight away, for a keyboard", async () => {
    const { container } = render(<GraduationKeepsake data={data("space")} locale="en" />);
    await begin(container);
    fireEvent.keyDown(holdButton(), { key: "Enter" });
    await flush(50, 4);
    expect(container.querySelector("[class*='finDone']")).not.toBeNull();
  });
});
