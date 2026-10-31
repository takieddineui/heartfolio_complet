import { act, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const motion = vi.hoisted(() => ({ reduced: false as boolean | null }));
// framer-motion reads the OS preference once per module load and caches it, so the
// preference cannot be flipped between tests through `matchMedia`. The page's gate
// depends on the hook's VALUE (true, false, or null while unknown), so that is what
// the tests control; framer's own reading of the preference is framer's job.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motion.reduced,
}));

import { LiveKeepsake } from "./live-keepsake";
import { LIVE_MOTION, LIVE_MOTION_VARS, SPARK_PATH, SPARK_VIEWBOX, liveMotionStyle } from "./live-motion";

/**
 * The live page's motion: a milestone that fades, rises and scales in as it is
 * reached, its photograph settling a little behind it, and one brand spark
 * caught at its node the first time it is reached.
 *
 * What these pin, because a later "improvement" would quietly undo them: every
 * motion value is NAMED (one source, CSS fallbacks held equal); the spark is a
 * SCRIPTED effect with its own reduced-motion check rather than leaning on the
 * global CSS rule; it fires once per milestone and only when reached; nothing is
 * driven by a scroll listener (the page's rule: a listener fires every frame and
 * would run layout maths on a phone); and the CSS has no physical left/right
 * properties, so it is correct in right-to-left pages.
 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const live = strip(readFileSync("src/components/live/live-keepsake.module.css", "utf8"));
const sparkCss = strip(readFileSync("src/components/live/milestone-spark.module.css", "utf8"));
const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

const UNIT: Partial<Record<keyof typeof LIVE_MOTION, string>> = {
  enterMs: "ms", enterRisePx: "px", photoSettleMs: "ms", photoSettleDelayMs: "ms", sparkMs: "ms", sparkSizePx: "px",
};
const asCss = (key: keyof typeof LIVE_MOTION) => `${LIVE_MOTION[key]}${UNIT[key] ?? ""}`;

describe("named motion values", () => {
  it("hands every value to the page as a custom property, with its unit", () => {
    const style = liveMotionStyle() as Record<string, string>;
    for (const key of Object.keys(LIVE_MOTION_VARS) as (keyof typeof LIVE_MOTION)[]) {
      expect(style[LIVE_MOTION_VARS[key]], key).toBe(asCss(key));
    }
  });

  it("lets a future style hand a different set to the same markup", () => {
    const style = liveMotionStyle({ enterMs: 1200, sparkSizePx: 24 }) as Record<string, string>;
    expect(style["--live-enter-ms"]).toBe("1200ms");
    expect(style["--live-spark-size"]).toBe("24px");
    expect(style["--live-enter-rise"]).toBe("16px");
  });

  it("is read by the CSS under the same name with the same fallback (no drift, no bare number)", () => {
    const css = live + "\n" + sparkCss;
    for (const key of Object.keys(LIVE_MOTION_VARS) as (keyof typeof LIVE_MOTION)[]) {
      const name = LIVE_MOTION_VARS[key];
      const uses = fallbacksOf(css, name);
      expect(uses.length, `${name} is never read by the CSS`).toBeGreaterThan(0);
      for (const fallback of uses) expect(fallback, `${name} fallback`).toBe(asCss(key));
    }
  });

  /** Every fallback written for `name` in `css`, read to the matching close bracket (a fallback can itself contain brackets). */
  function fallbacksOf(css: string, name: string): string[] {
    const found: string[] = [];
    const opener = `var(${name},`;
    for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
      let depth = 1;
      let i = at + 3; // the "(" of "var("
      while (depth > 0 && i < css.length - 1) {
        i += 1;
        if (css[i] === "(") depth += 1;
        else if (css[i] === ")") depth -= 1;
      }
      found.push(css.slice(at + opener.length, i).trim());
    }
    return found;
  }

  it("uses the brand ease, the curve the opening and the reveal use", () => {
    expect(LIVE_MOTION.ease).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(readFileSync("src/components/live/opening-sequence.tsx", "utf8")).toContain("[0.22, 1, 0.36, 1]");
    expect(readFileSync("src/components/motion/reveal.tsx", "utf8")).toContain("[0.22, 1, 0.36, 1]");
  });
});

describe("the entrance", () => {
  it("starts a milestone slightly low and small and settles it, on the named values", () => {
    const step = rule(live, ".step");
    expect(step).toMatch(/transform:\s*translateY\(var\(--live-enter-rise[^)]*\)\)\s*scale\(var\(--live-enter-scale/);
    expect(step).toMatch(/transition:[\s\S]*opacity var\(--live-enter-ms[\s\S]*transform var\(--live-enter-ms/);
    expect(rule(live, ".stepActive")).toMatch(/opacity:\s*1/);
    expect(rule(live, ".stepActive")).toMatch(/transform:\s*none/);
  });

  it("settles the photograph inside a clipping frame, a little behind the milestone", () => {
    const frame = rule(live, ".photoButton");
    expect(frame).toMatch(/overflow:\s*hidden/);
    // The radius and shadow live on the frame so the clip is clean.
    expect(frame).toMatch(/border-radius:\s*3px/);
    expect(frame).toMatch(/box-shadow:/);
    const photo = rule(live, ".photo");
    expect(photo).toMatch(/transform:\s*scale\(var\(--live-photo-settle-scale/);
    expect(photo).toMatch(/transition:\s*transform var\(--live-photo-settle-ms[^;]*var\(--live-photo-settle-delay/);
    expect(photo).not.toMatch(/box-shadow/);
    expect(live).toMatch(/\.stepActive \.photo\s*\{[^}]*transform:\s*none/);
  });

  it("removes the movement under reduced motion and keeps the fade", () => {
    const media = live.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(media).toMatch(/\.step\s*\{[^}]*transform:\s*none/);
    expect(media).toMatch(/\.photo\s*\{[^}]*transform:\s*none/);
    expect(media).not.toMatch(/opacity/);
  });
});

describe("the spark: a scripted effect", () => {
  class FakeObserver {
    static instances: FakeObserver[] = [];
    elements: Element[] = [];
    constructor(public callback: IntersectionObserverCallback) {
      FakeObserver.instances.push(this);
    }
    observe(el: Element) { this.elements.push(el); }
    unobserve() {}
    disconnect() { this.elements = []; FakeObserver.instances = FakeObserver.instances.filter((o) => o !== this); }
    takeRecords() { return []; }
  }
  const live_ = () => FakeObserver.instances[FakeObserver.instances.length - 1]!;
  const reach = (el: Element, isIntersecting = true) =>
    act(() => live_().callback([{ target: el, isIntersecting } as IntersectionObserverEntry], live_() as unknown as IntersectionObserver));

  const mockMotion = (reduce: boolean | null) => {
    motion.reduced = reduce;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: reduce === true && /reduce/.test(query), media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };

  const values = {
    people: [{ name: "Emma" }, { name: "James" }], posterTitle: "Our Love Story", endingText: "Forever",
    events: [1, 2, 3].map((n) => ({ date: `2020-0${n}-10`, title: `Moment ${n}`, description: "A day.", photo: { url: "" } })),
  };
  const media = { backgroundMusic: null, milestones: [1, 2, 3].map(() => ({ video: null, audio: null })) };
  const mount = () =>
    render(<LiveKeepsake values={values} themeSelections={{ palette: "classic", typography: "serif-classic" }} media={media} locale="en" />);
  const sparksIn = (container: HTMLElement) => container.querySelectorAll(`ol li svg path[d="${SPARK_PATH}"]`);
  const steps = (container: HTMLElement) => [...container.querySelectorAll("ol > li")];

  beforeEach(() => {
    FakeObserver.instances = [];
    window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => vi.restoreAllMocks());

  it("is not there before anything is reached", () => {
    mockMotion(false);
    const { container } = mount();
    expect(sparksIn(container)).toHaveLength(0);
  });

  it("catches one spark at the milestone that was reached, and only there", () => {
    mockMotion(false);
    const { container } = mount();
    reach(steps(container)[1]!);
    expect(sparksIn(container)).toHaveLength(1);
    expect(steps(container)[1]!.querySelectorAll(`svg path[d="${SPARK_PATH}"]`)).toHaveLength(1);
    expect(steps(container)[0]!.querySelectorAll(`svg path[d="${SPARK_PATH}"]`)).toHaveLength(0);
    expect(steps(container)[2]!.querySelectorAll(`svg path[d="${SPARK_PATH}"]`)).toHaveLength(0);
  });

  it("catches it ONCE per milestone however often it is reached again", () => {
    mockMotion(false);
    const { container } = mount();
    for (let i = 0; i < 4; i++) reach(steps(container)[1]!);
    expect(sparksIn(container)).toHaveLength(1);
    reach(steps(container)[0]!);
    reach(steps(container)[2]!);
    reach(steps(container)[1]!);
    expect(sparksIn(container)).toHaveLength(3);
  });

  it("does nothing for a milestone that is leaving, not arriving", () => {
    mockMotion(false);
    const { container } = mount();
    reach(steps(container)[1]!, false);
    expect(sparksIn(container)).toHaveLength(0);
  });

  it("never mounts one when the visitor prefers reduced motion (its own check, not the CSS rule)", () => {
    mockMotion(true);
    const { container } = mount();
    for (const step of steps(container)) reach(step);
    expect(sparksIn(container)).toHaveLength(0);
  });

  it("never mounts one while the preference is still unknown", () => {
    mockMotion(null);
    const { container } = mount();
    for (const step of steps(container)) reach(step);
    expect(sparksIn(container)).toHaveLength(0);
  });

  it("is hidden by the stylesheet under reduced motion as well, for a preference that changes mid-visit", () => {
    expect(sparkCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.spark\s*\{[^}]*display:\s*none/);
  });

  it("fires once and stays quiet: a single run, no loop, no overshoot", () => {
    expect(sparkCss).toMatch(/animation:\s*spark-catch[^;]*\b1 both/);
    expect(sparkCss).not.toMatch(/infinite/);
    const frames = sparkCss.match(/@keyframes spark-catch\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const scales = [...frames.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...scales)).toBeLessThanOrEqual(1);
  });
});

describe("what it must not break", () => {
  const sources = ["live-keepsake.tsx", "milestone-spark.tsx", "live-motion.ts"].map(
    (file) => [file, readFileSync(`src/components/live/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")] as const
  );

  it.each(sources)("%s adds no scroll listener (the observer is the only trigger)", (_file, source) => {
    expect(source).not.toMatch(/addEventListener\(\s*["']scroll["']/);
    expect(source).not.toMatch(/onScroll|useScroll|requestAnimationFrame/);
  });

  it("gates the scripted effect on an explicit `false`, and re-subscribes when the preference changes", () => {
    const component = sources.find(([file]) => file === "live-keepsake.tsx")![1];
    expect(component).toMatch(/useReducedMotion\(\)\s*===\s*false/);
    expect(component).toMatch(/\[milestones\.length,\s*motionAllowed\]/);
  });

  it("has no physical left/right in the spark's CSS, so right-to-left pages are correct", () => {
    expect(sparkCss).not.toMatch(/(^|[^-])(left|right)\s*:/);
    expect(sparkCss).not.toMatch(/margin-(left|right)|padding-(left|right)|translateX|rotateY|text-align:\s*(left|right)/);
  });

  it("centres the spark by flex on its parent, which is correct in both directions", () => {
    const spark = rule(sparkCss, ".spark");
    expect(spark).toMatch(/position:\s*absolute/);
    expect(spark).toMatch(/inset:\s*0/);
    expect(spark).toMatch(/display:\s*flex/);
    expect(spark).toMatch(/align-items:\s*center/);
    expect(spark).toMatch(/justify-content:\s*center/);
  });

  it("draws the SAME spark as the intro and the ending: one shared path, no copies (31 Oct 2026)", () => {
    const opening = readFileSync("src/components/live/live-intro.tsx", "utf8");
    const ending = readFileSync("src/components/live/ending-spark.tsx", "utf8");
    for (const source of [opening, ending]) {
      expect(source).toMatch(/from "@\/lib\/brand\/mark"/);
      expect(source).toContain("d={SPARK_PATH}");
      expect(source).not.toContain(SPARK_PATH);
    }
    expect(ending).toContain("viewBox={SPARK_VIEWBOX}");
    expect(SPARK_VIEWBOX).toBe("43 6 16 17");
  });
});
