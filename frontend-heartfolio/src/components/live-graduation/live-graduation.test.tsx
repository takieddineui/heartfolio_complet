import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false as boolean | null }));
// The component gates SCRIPTED effects on the hook's value (true, false, or
// null while the preference is unknown), so that is what the tests control.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motion.reduced,
}));

import { LiveGraduation } from "./live-graduation";

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const photo = (name: string) => ({ url: `https://cdn.test/${name}.jpg` });

const values = (extra: Record<string, unknown> = {}) => ({
  language: "en",
  gradName: "Maya",
  gradFullName: "Maya Chen",
  gradDegree: "BA Architecture",
  gradSchool: "Edinburgh",
  gradDate: "2027-07-02",
  gradPhoto: photo("grad"),
  thenYear: "2005",
  thenText: "A child who drew houses.",
  thenPhoto: photo("then"),
  stops: [
    { year: "2010", caption: "First day of school", photo: photo("s1"), code: "SCH" },
    { year: "2014", caption: "Lego city", photo: photo("s2") },
  ],
  nowYear: "2027",
  nowText: "An architect.",
  nextText: "Copenhagen.",
  nextPhoto: photo("next"),
  achievements: [{ title: "First-class honours" }, { title: "Dean's list" }],
  messageGroups: [
    {
      label: "From home",
      people: [
        { name: "Mum", color: "coral", emoji: "home", message: "So proud.", voice: { url: "https://cdn.test/v.m4a" } },
        { name: "Dad", color: "blue", emoji: "coffee", message: "Well done." },
      ],
    },
  ],
  goals: [{ text: "Start in Copenhagen", code: "CPH" }],
  letterGreeting: "Dear Maya,",
  letterBody: [{ text: "Go and build it." }],
  letterSignoff: "With love,",
  letterSignatures: [{ name: "Mum" }],
  endingLine: "Congratulations, Maya!",
  endingSub: "Your next chapter starts now.",
  ...extra,
});

const theme = { journey: "airline" };

async function renderLive(extra: Record<string, unknown> = {}, props: { embedded?: boolean; locale?: string } = {}) {
  const view = render(
    <LiveGraduation values={values(extra)} themeSelections={theme} locale={props.locale ?? "en"} embedded={props.embedded} />
  );
  // The journey is a lazy chunk; wait for its boarding pass.
  await screen.findByRole("button", { name: /tear to board/i });
  return view;
}

const region = () => screen.getByRole("region", { name: /maya chen/i });
async function begin() {
  fireEvent.click(screen.getByRole("button", { name: /tear to board/i }));
  await waitFor(() => expect(region()).not.toHaveAttribute("inert"));
}

let drawn = 0;
beforeEach(() => {
  motion.reduced = false;
  drawn = 0;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill: () => void drawn++,
        fillRect: () => void drawn++,
      }) as unknown as CanvasRenderingContext2D
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the flow", () => {
  it("opens on the boarding pass, and the page behind it is unreachable until it is torn", async () => {
    await renderLive();
    expect(region()).toHaveAttribute("inert");
    expect(screen.getByText(/welcome aboard, maya/i, { selector: "strong" })).toBeInTheDocument();
    await begin();
    expect(region()).not.toHaveAttribute("inert");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome aboard, Maya");
  });

  it("start again returns to the opening with chapter state reset", async () => {
    motion.reduced = true; // the take-off completes at once
    await renderLive();
    await begin();
    fireEvent.click(screen.getByRole("button", { name: "Passport page 1" }));
    expect(screen.getByText("1 of 2 stamped")).toBeInTheDocument();
    // "Start again" is part of the ending, which is not reachable until take-off.
    fireEvent.click(screen.getByRole("button", { name: /ready for take-off/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start again/i }));
    await screen.findByRole("button", { name: /tear to board/i });
    await begin();
    expect(screen.getByText("0 of 2 stamped")).toBeInTheDocument();
  });

  it("falls back to the airline journey for an unknown journey id", async () => {
    render(<LiveGraduation values={values()} themeSelections={{ journey: "nope" }} locale="en" />);
    expect(await screen.findByRole("button", { name: /tear to board/i })).toBeInTheDocument();
  });
});

describe("the story", () => {
  it("shows every chapter, titled by the journey rather than the creator", async () => {
    await renderLive();
    await begin();
    for (const title of ["Your flight path", "Your passport", "Postcards for the journey", "Your itinerary", "A note from your crew"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it("omits a chapter the creator switched off", async () => {
    await renderLive({ showAchievements: false, showMessages: false, showLetter: false });
    await begin();
    expect(screen.queryByRole("heading", { name: "Your passport" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Postcards for the journey" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your flight path" })).toBeInTheDocument();
  });

  it("speaks the keepsake's language, right to left in Arabic, whatever the site's locale", async () => {
    render(<LiveGraduation values={values({ language: "ar" })} themeSelections={theme} locale="en" />);
    const pass = await screen.findByRole("button", { name: /مزّق للصعود/ });
    expect(pass.closest("[dir]")).toHaveAttribute("dir", "rtl");
    expect(pass.closest("[lang]")).toHaveAttribute("lang", "ar");
  });

  it("uses the French wording for a French keepsake", async () => {
    render(<LiveGraduation values={values({ language: "fr" })} themeSelections={theme} locale="en" />);
    expect(await screen.findByRole("button", { name: /déchirez pour embarquer/i })).toBeInTheDocument();
  });
});

describe("interactions", () => {
  it("stamps a passport page once, counts, and announces the count politely", async () => {
    await renderLive();
    await begin();
    const page = screen.getByRole("button", { name: "Passport page 1" });
    expect(page).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(page);
    const stamped = screen.getByRole("button", { name: "Stamp: First-class honours" });
    expect(stamped).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(stamped);
    expect(screen.getByText("1 of 2 stamped")).toHaveAttribute("aria-live", "polite");
  });

  it("turns a postcard over, and only then offers its voice message", async () => {
    await renderLive();
    await begin();
    expect(screen.queryByRole("button", { name: "Play voice message" })).not.toBeInTheDocument();
    const card = screen.getAllByRole("button", { pressed: false }).find((b) => /Mum/.test(b.textContent ?? ""))!;
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Play voice message" })).toBeInTheDocument();
    // Dad has no voice message, so turning his card shows none.
    const dad = screen.getAllByRole("button", { pressed: false }).find((b) => /Dad/.test(b.textContent ?? ""))!;
    fireEvent.click(dad);
    expect(screen.getAllByRole("button", { name: /voice message/i })).toHaveLength(1);
  });

  it("plays and pauses a voice message, one at a time", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public src: string) {}
        play = play;
        pause = pause;
      }
    );
    await renderLive();
    await begin();
    fireEvent.click(screen.getAllByRole("button", { pressed: false }).find((b) => /Mum/.test(b.textContent ?? ""))!);
    fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.click(await screen.findByRole("button", { name: "Pause voice message" }));
    expect(pause).toHaveBeenCalled();
  });

  it("opens a photo in a dialog, keeps focus inside it, closes on Escape and gives focus back", async () => {
    await renderLive();
    await begin();
    const opener = screen.getByRole("button", { name: /open photo: first day of school/i });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("img", { name: "First day of school" })).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(region()).toHaveAttribute("inert");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    expect(region()).not.toHaveAttribute("inert");
  });

  it("steps through the photos and wraps around", async () => {
    await renderLive();
    await begin();
    fireEvent.click(screen.getByRole("button", { name: /open photo: first day of school/i }));
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "Lego city" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "First day of school" })).toBeInTheDocument();
  });

  it("completes the take-off and then shows the ending with its actions", async () => {
    motion.reduced = true; // no animation to wait for
    await renderLive();
    await begin();
    // Before take-off the ending exists but cannot be reached or read.
    expect(screen.queryByRole("button", { name: /start again/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ready for take-off/i }));
    await screen.findByRole("button", { name: /start again/i });
    expect(screen.getByRole("heading", { level: 2, name: "Congratulations, Maya!" })).toBeInTheDocument();
    expect(screen.getByText("Made with Heartfolio")).toBeInTheDocument();
  });
});

describe("options", () => {
  it("offers sharing on the real page and not inside the Studio", async () => {
    const { unmount } = await renderLive();
    await begin();
    expect(screen.getAllByRole("button", { name: "Share" }).length).toBeGreaterThan(0);
    unmount();
    await renderLive({}, { embedded: true });
    await begin();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("omits the share button and the credit line when the creator turned them off", async () => {
    motion.reduced = true;
    await renderLive({ shareEnabled: false, brandingShow: false });
    await begin();
    fireEvent.click(screen.getByRole("button", { name: /ready for take-off/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Congratulations, Maya!" })).toBeVisible());
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    expect(screen.queryByText("Made with Heartfolio")).not.toBeInTheDocument();
  });

  it("lets the graduate mute, and offers no toggle when the creator turned sound off", async () => {
    const { unmount } = await renderLive();
    const chip = screen.getByRole("button", { name: "Sound on" });
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: "Sound off" })).toHaveAttribute("aria-pressed", "false");
    unmount();
    await renderLive({ soundEnabled: false });
    expect(screen.queryByRole("button", { name: /^sound/i })).not.toBeInTheDocument();
  });
});

describe("motion", () => {
  async function stampEverything() {
    await begin();
    fireEvent.click(screen.getByRole("button", { name: "Passport page 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Passport page 2" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
  }

  it("throws the confetti when every stamp is in, if motion is allowed", async () => {
    await renderLive();
    await stampEverything();
    await waitFor(() => expect(drawn).toBeGreaterThan(0));
  });

  it("throws nothing when the visitor prefers reduced motion", async () => {
    motion.reduced = true;
    await renderLive();
    await stampEverything();
    expect(drawn).toBe(0);
  });

  it("throws nothing while the preference is still unknown", async () => {
    motion.reduced = null;
    await renderLive();
    await stampEverything();
    expect(drawn).toBe(0);
  });

  it("starts straight away, without waiting for a tear animation, under reduced motion", async () => {
    motion.reduced = true;
    await renderLive();
    await begin();
    expect(screen.queryByRole("button", { name: /tear to board/i })).not.toBeInTheDocument();
  });
});

describe("embedding", () => {
  it("never touches <html> or <body>: it is safe inside the Studio", async () => {
    const htmlBefore = document.documentElement.outerHTML.replace(/<body[\s\S]*<\/body>/, "");
    const bodyAttributes = () => [...document.body.attributes].map((a) => `${a.name}=${a.value}`).join(" ");
    const bodyBefore = bodyAttributes();
    await renderLive({}, { embedded: true });
    await begin();
    expect(document.documentElement.outerHTML.replace(/<body[\s\S]*<\/body>/, "")).toBe(htmlBefore);
    expect(bodyAttributes()).toBe(bodyBefore);
  });
});
