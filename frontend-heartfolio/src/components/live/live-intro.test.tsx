import { act, render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIFTS } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";
import { LIVE_FRAME_COPY } from "./live-frame-copy";
import { INTRO_TIMING, LiveIntro, introDecideScript, introRunScript } from "./live-intro";
import { INTRO_DONE_EVENT, INTRO_ID, INTRO_STATE_ID, LIVE_READY_EVENT } from "./live-intro-ids";
import { GRADUATION_GROUNDS, REASONS_GROUNDS, SONG_GROUND, introGround } from "./live-intro-ground";
import { LiveIntroFrame, useLiveIntroDone } from "./live-intro-state";
import { LivePayloadView } from "./live-payload";

/**
 * The shared intro and closing line of every live page (owner, 27 Oct 2026):
 * 1.6s, from first paint, tap to skip, off under reduced motion, translated,
 * held for the page up to 2.5s in all, and only on the first open of a gift
 * on a device.
 */
const ID = "a2241d62-a9dd-459b-b7c6-e4fe0f5ad8ba";

function mountIntroDom() {
  document.body.innerHTML = `<i id="${INTRO_STATE_ID}" hidden></i><div id="${INTRO_ID}"></div>`;
  return {
    state: () => document.getElementById(INTRO_STATE_ID)!.getAttribute("data-s"),
    intro: document.getElementById(INTRO_ID)!,
  };
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const run = (source: string) => new Function(source)();

/** jsdom here has no `localStorage` (an opaque origin): an in-memory one. */
function installStorage() {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  return storage;
}

describe("the intro's scripts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    installStorage();
    setReducedMotion(false);
    delete (window as { __hfLiveReady?: boolean }).__hfLiveReady;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("plays on the first open of a gift on this device, never on the next", () => {
    let dom = mountIntroDom();
    run(introDecideScript(ID));
    expect(dom.state()).toBe("playing");
    dom = mountIntroDom();
    run(introDecideScript(ID));
    expect(dom.state()).toBe("done");
    // Another gift is a first open of its own.
    dom = mountIntroDom();
    run(introDecideScript("ee54048e-f592-465f-9b4a-8b006f98c8db"));
    expect(dom.state()).toBe("playing");
  });

  it("never plays under reduced motion", () => {
    setReducedMotion(true);
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    expect(dom.state()).toBe("done");
  });

  it("still plays when storage is refused (a private window)", () => {
    const storage = installStorage();
    storage.getItem = () => {
      throw new Error("denied");
    };
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    expect(dom.state()).toBe("playing");
  });

  it("leaves 1.25s in when the page was ready sooner, and hands over after the fade", () => {
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    run(introRunScript());
    const done = vi.fn();
    window.addEventListener(INTRO_DONE_EVENT, done);
    vi.advanceTimersByTime(300);
    window.dispatchEvent(new Event(LIVE_READY_EVENT));
    vi.advanceTimersByTime(INTRO_TIMING.leaveAfterMs - 300 - 1);
    expect(dom.intro.getAttribute("data-state")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(dom.intro.getAttribute("data-state")).toBe("leaving");
    expect(dom.intro.style.getPropertyValue("--hf-out")).toBe(`${INTRO_TIMING.fadeMs}ms`);
    vi.advanceTimersByTime(INTRO_TIMING.fadeMs);
    expect(dom.state()).toBe("done");
    expect(done).toHaveBeenCalledOnce();
    window.removeEventListener(INTRO_DONE_EVENT, done);
  });

  it("holds for a page that is ready later, then leaves at once", () => {
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    run(introRunScript());
    vi.advanceTimersByTime(1900);
    expect(dom.intro.getAttribute("data-state")).toBeNull();
    window.dispatchEvent(new Event(LIVE_READY_EVENT));
    vi.advanceTimersByTime(0);
    expect(dom.intro.getAttribute("data-state")).toBe("leaving");
  });

  it("never holds past the cap: 2.5s in all", () => {
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    run(introRunScript());
    vi.advanceTimersByTime(INTRO_TIMING.capMs);
    expect(dom.intro.getAttribute("data-state")).toBe("leaving");
    vi.advanceTimersByTime(INTRO_TIMING.fadeMs);
    expect(dom.state()).toBe("done");
    expect(INTRO_TIMING.capMs + INTRO_TIMING.fadeMs).toBe(2500);
    expect(INTRO_TIMING.leaveAfterMs + INTRO_TIMING.fadeMs).toBe(1600);
  });

  it("a page hydrated before the script ran is not waited for twice", () => {
    (window as { __hfLiveReady?: boolean }).__hfLiveReady = true;
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    run(introRunScript());
    vi.advanceTimersByTime(INTRO_TIMING.leaveAfterMs);
    expect(dom.intro.getAttribute("data-state")).toBe("leaving");
  });

  it("a tap, Esc or Enter skips with a short fade", () => {
    for (const skip of [(el: HTMLElement) => el.click(), () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })), () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))]) {
      localStorage.clear();
      const dom = mountIntroDom();
      run(introDecideScript(ID));
      run(introRunScript());
      vi.advanceTimersByTime(400);
      skip(dom.intro);
      expect(dom.intro.getAttribute("data-state")).toBe("leaving");
      expect(dom.intro.style.getPropertyValue("--hf-out")).toBe(`${INTRO_TIMING.skipFadeMs}ms`);
      vi.advanceTimersByTime(INTRO_TIMING.skipFadeMs);
      expect(dom.state()).toBe("done");
    }
  });

  it("does nothing on a repeat visit", () => {
    localStorage.setItem(`hf-intro:${ID}`, "1");
    const dom = mountIntroDom();
    run(introDecideScript(ID));
    run(introRunScript());
    vi.advanceTimersByTime(5000);
    expect(dom.intro.getAttribute("data-state")).toBeNull();
    expect(dom.state()).toBe("done");
  });

  it("the server component imports its names from a plain module, never a client one", () => {
    // Imported from a "use client" module, a constant reaches a server
    // component as a client reference: the first build wrote an error
    // message into the scripts in place of the element's id.
    const source = readFileSync("src/components/live/live-intro.tsx", "utf8");
    expect(source).not.toMatch(/^"use client"/);
    for (const [, from] of source.matchAll(/from "(\.\/[^"]+)"/g)) {
      const file = readdirSync("src/components/live").find((f) => f.startsWith(from!.slice(2) + ".") && !f.endsWith(".css"));
      if (file) expect(readFileSync(`src/components/live/${file}`, "utf8"), file).not.toMatch(/^"use client"/);
    }
  });

  it("writes only a UUID into the script", () => {
    expect(() => introDecideScript('x");alert(1);("')).toThrow();
  });
});

describe("the intro's markup", () => {
  it("is hidden from screen readers, in the order's language, on the gift's own ground", () => {
    for (const locale of ["en", "fr", "ar"] as const) {
      const html = renderToStaticMarkup(<LiveIntro liveId={ID} locale={locale} ground={{ bg: "#163d2c", ink: "#f3ecd8" }} />);
      expect(html).toContain(`id="${INTRO_ID}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(LIVE_FRAME_COPY[locale].introLine);
      expect(html).toContain(LIVE_FRAME_COPY[locale].skip);
      expect(html).toContain("--intro-bg:#163d2c");
      // The state marker, then the deciding script, then the intro.
      expect(html.indexOf(INTRO_STATE_ID)).toBeLessThan(html.indexOf("<script"));
      expect(html.indexOf("<script")).toBeLessThan(html.indexOf(`id="${INTRO_ID}"`));
    }
    expect(renderToStaticMarkup(<LiveIntro liveId={ID} locale="ar" ground={SONG_GROUND} />)).toContain('dir="rtl"');
    // The site's own mark: its gradients, never flat colours (31 Oct 2026).
    const mark = renderToStaticMarkup(<LiveIntro liveId={ID} locale="en" ground={SONG_GROUND} />);
    expect(mark.match(/stroke="url\(#hf-intro-ribbon\)"/g)).toHaveLength(3);
    expect(mark.match(/stroke="url\(#hf-intro-over\)"/g)).toHaveLength(1);
    expect(mark).toContain('fill="url(#hf-intro-spark)"');
    expect(mark).not.toMatch(/stroke="#/);
  });

  it("copy: the approved English and French, an Arabic line, no point médian", () => {
    expect(LIVE_FRAME_COPY.en.introLine).toBe("A gift for you");
    expect(LIVE_FRAME_COPY.fr.introLine).toBe("Un cadeau pour toi");
    expect(LIVE_FRAME_COPY.ar.introLine).toMatch(/[؀-ۿ]/);
    for (const copy of Object.values(LIVE_FRAME_COPY)) {
      expect(copy.madeWith).toContain("Heartfolio");
      expect(Object.values(copy).join(" ")).not.toContain("·e");
    }
  });

  it("CSS: hidden under reduced motion and once done; its timing comes from INTRO_TIMING", () => {
    const css = readFileSync("src/components/live/live-intro.module.css", "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.intro\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.state\[data-s="done"\] ~ \.intro\s*\{\s*display:\s*none/);
    expect(css).toContain("animation: hfIntroOut var(--hf-fade) ease var(--hf-cap) forwards");
    for (const value of Object.values(INTRO_TIMING)) expect(css).not.toContain(`${value}ms`);
  });
});

describe("handing over", () => {
  function Probe() {
    return <span data-testid="probe">{String(useLiveIntroDone())}</span>;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("without the intro (capture page, Studio), a product starts at once", () => {
    const { getByTestId } = render(<LiveIntroFrame present={false}><Probe /></LiveIntroFrame>);
    expect(getByTestId("probe").textContent).toBe("true");
  });

  it("with the intro, a product waits for it, then starts", () => {
    const marker = document.createElement("i");
    marker.id = INTRO_STATE_ID;
    marker.setAttribute("data-s", "playing");
    document.body.appendChild(marker);
    const ready = vi.fn();
    window.addEventListener(LIVE_READY_EVENT, ready);
    const { getByTestId } = render(<LiveIntroFrame present><Probe /></LiveIntroFrame>);
    expect(getByTestId("probe").textContent).toBe("false");
    expect(ready).toHaveBeenCalledOnce();
    act(() => {
      marker.setAttribute("data-s", "done");
      window.dispatchEvent(new Event(INTRO_DONE_EVENT));
    });
    expect(getByTestId("probe").textContent).toBe("true");
    window.removeEventListener(LIVE_READY_EVENT, ready);
  });

  it("only the real live route asks for the intro; the capture page does not", () => {
    expect(readFileSync("src/app/[locale]/live/[liveId]/page.tsx", "utf8")).toContain("<LivePayloadView payload={payload} liveId={liveId} intro />");
    const capture = readdirSync("src/app/[locale]/capture", { recursive: true })
      .filter((file) => String(file).endsWith(".tsx"))
      .map((file) => readFileSync(join("src/app/[locale]/capture", String(file)), "utf8"))
      .join("\n");
    expect(capture).toContain("<LivePayloadView");
    expect(capture).not.toMatch(/<LivePayloadView[^>]*\bintro\b/);
    expect(LivePayloadView).toBeTypeOf("function");
  });
});

describe("the gift's own ground", () => {
  const css = (file: string) => readFileSync(file, "utf8");

  it("Song Poster's page colours", () => {
    const sheet = css("src/components/live-song/song-live-keepsake.module.css");
    expect(sheet).toContain(`--paper: ${SONG_GROUND.bg}`);
    expect(sheet).toContain(`--ink: ${SONG_GROUND.ink}`);
  });

  it("every Reasons gift's colours", () => {
    const sheet = css("src/components/live-reasons/reasons-keepsake.module.css");
    expect(Object.keys(REASONS_GROUNDS).sort()).toEqual(Object.keys(GIFTS).sort());
    for (const [gift, ground] of Object.entries(REASONS_GROUNDS)) {
      const rule = sheet.split("\n").find((line) => line.startsWith(`.frame[data-gift="${gift}"]`))!;
      expect(rule).toContain(`--bg: ${ground.bg}`);
      expect(rule).toContain(`--ink: ${ground.ink}`);
    }
  });

  it("every Graduation journey's colours", () => {
    const sheet = css("src/components/live-graduation/graduation-keepsake.module.css");
    for (const [journey, ground] of Object.entries(GRADUATION_GROUNDS)) {
      const rule = sheet.split("\n").find((line) => line.startsWith(`.frame[data-j="${journey}"]`))!;
      expect(rule).toContain(`--bg: ${ground.bg}`);
      expect(rule).toContain(`--ink: ${ground.ink}`);
    }
  });

  it("Love Story Timeline: the order's own palette", () => {
    const classic = introGround("love-story-timeline", {}, { palette: "classic" });
    const midnight = introGround("love-story-timeline", {}, { palette: "midnight" });
    expect(classic.bg.toLowerCase()).toBe("#f7f1e6");
    expect(midnight.bg.toLowerCase()).toBe("#141b2e");
  });
});

describe("the closing line", () => {
  it("is the shared component on every live page, never a hand-written line", () => {
    const folders = ["live", "live-song", "live-reasons", "live-graduation"];
    for (const folder of folders) {
      const sources = readdirSync(`src/components/${folder}`)
        .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
        .map((file) => readFileSync(`src/components/${folder}/${file}`, "utf8"))
        .join("\n");
      expect(sources, folder).not.toContain("Made with Heartfolio");
      if (folder !== "live") expect(sources, folder).toContain("<LiveColophon");
    }
    expect(readFileSync("src/components/live/live-keepsake.tsx", "utf8")).toContain("<LiveColophon");
  });
});
