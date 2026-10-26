import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * §10 — the Digital keepsake.
 *
 * Source-level, because the properties that matter are choices the spec
 * makes explicitly and a later "improvement" would quietly reverse:
 * autoplay, minute-counters, and forcing the poster's geometry onto the web.
 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const component = strip(readFileSync("src/components/live/live-keepsake.tsx", "utf8"));
const page = strip(readFileSync("src/app/[locale]/live/[liveId]/page.tsx", "utf8"));
/** Where the page hands each product's payload to its component (moved out
 *  of the page, 26 Oct 2026, so the capture page shares it). */
const dispatch = strip(readFileSync("src/components/live/live-payload.tsx", "utf8"));
const css = readFileSync("src/components/live/live-keepsake.module.css", "utf8");

describe("live keepsake", () => {
  it("never autoplays music", () => {
    /**
     * §10 requires music user-controlled. Browsers block autoplay anyway,
     * but the reason to build it this way is that a keepsake opening with
     * unexpected sound — possibly in public — is a bad first moment for a
     * gift.
     */
    expect(component).not.toContain("autoPlay");
    expect(component).not.toContain("autoplay");
    expect(component).toContain("musicOn");
  });

  it("starts with music off", () => {
    expect(component).toContain("useState(false)");
  });

  it("counts in years, months and days rather than minutes", () => {
    // §10 is explicit: exact minutes should not be the default merely
    // because it is possible. "4 years, 2 months" is meaningful.
    expect(component).toContain("years");
    expect(component).toContain("months");
    expect(component).not.toMatch(/minutes|getMinutes/);
  });

  it("activates milestones as the reader progresses", () => {
    expect(component).toContain("IntersectionObserver");
    expect(css).toContain(".stepActive");
  });

  it("uses an observer rather than a scroll handler", () => {
    // A scroll listener fires every frame and would run layout maths on a
    // phone for the whole length of the story.
    expect(component).not.toMatch(/addEventListener\(\s*["']scroll["']/);
  });

  it("does not preload every clip on open", () => {
    // Eight videos would otherwise start downloading the moment the page
    // opens, on a phone, before the reader reaches any of them.
    expect(component).toContain('preload="none"');
  });

  it("renders media only where it exists", () => {
    // §14's rule applies here too: a milestone without video is not a
    // milestone with an empty player.
    expect(component).toContain("media.milestones[index]?.video &&");
    expect(component).toContain("media.backgroundMusic &&");
  });

  it("formats a milestone's day in UTC, so no time zone shows the month before", () => {
    // "2019-04-01" is UTC midnight; formatted in a visitor's own zone west of
    // UTC it read "March 2019" (fixed 26 Oct 2026).
    expect(component).toContain('month: "long", timeZone: "UTC"');
  });

  it("uses the order's locale, not the URL's", () => {
    // A recipient opening an Arabic keepsake from an English link should
    // see the keepsake they were given.
    expect(dispatch).toContain("locale={payload.locale}");
    expect(page).toContain("<LivePayloadView payload={payload}");
  });

  it("is noindex and collapses every failure into one response", () => {
    expect(page).toContain("index: false");
    expect(page).toContain("notFound()");
  });

  it("is not linked from anywhere in site navigation", () => {
    for (const file of [
      "src/components/layout/header.tsx",
      "src/components/layout/footer.tsx",
      "src/app/sitemap.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["'`]\/live[/"'`]/);
    }
  });

  it('joins names with "&" only, never a middle dot or a translated word (§3)', () => {
    // This page previously joined with a middle dot — a third,
    // independently drifted implementation found while investigating an
    // unrelated reported bug, not the bug itself. The rule is unqualified:
    // "&" at every count, nothing else.
    expect(component).toContain('people.join(" & ")');
    expect(component).not.toContain('people.join(" \u00b7 ")');
  });
});
