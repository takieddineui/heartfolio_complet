import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Preview modes and the watermark.
 *
 * Source-level, like the §20 watermark test it extends, because the
 * properties are structural: which element wraps which. A rendering test
 * would show the current arrangement is fine; only reading the structure
 * shows nobody has inverted it.
 */
const renderer = readFileSync("src/components/studio/preview/component-renderer.tsx", "utf8");
const modes = readFileSync("src/components/studio/preview/preview-modes.tsx", "utf8");
const watermark = readFileSync("src/components/studio/preview/preview-watermark.tsx", "utf8");

describe("preview modes", () => {
  it("offers all three modes", () => {
    for (const mode of ["flat", "framed", "device"]) {
      expect(renderer).toContain(`"${mode}"`);
    }
  });

  it("keeps the watermark inside the artwork, not on the mockup", () => {
    /**
     * The mockup wraps the artwork, so the watermark rides along into every
     * mode. Watermarking the mockup instead would leave the actual design
     * clean in the middle of a frame — and the design is the part worth
     * protecting (§20).
     */
    const artworkStart = renderer.indexOf("const artwork = (");
    const artworkEnd = renderer.indexOf("return (", artworkStart);
    const artwork = renderer.slice(artworkStart, artworkEnd);

    expect(artwork).toContain("PreviewWatermark");
    // The mockups receive the artwork as children; they do not contain a
    // watermark of their own.
    expect(modes).not.toContain("PreviewWatermark");
  });

  it("still carries the site link in the watermark", () => {
    expect(watermark).toContain("SITE_DOMAIN");
  });

  it("previews device wallpapers with their own composition, not the poster scaled down", () => {
    // A phone wallpaper shown at poster proportions — or worse, the
    // poster's OWN component (built for a poster's proportions and font
    // sizes) squeezed directly into a phone-shaped box — looks correct in
    // the Studio and wrong on the phone. This used to assert the literal
    // mechanism of the second failure (`deviceSize.width` sizing the
    // poster component for device mode) as if it were the fix; it was
    // actually the bug, found and corrected once someone looked at the
    // rendered result rather than only the source. `StoryWallpaper` (see
    // its own docstring in preview-modes.tsx) is the real fix: a
    // dedicated composition mirroring the backend's own
    // `_render_story_wallpaper`, never the `Product` poster component.
    expect(renderer).toContain("WALLPAPER_DEVICES");
    expect(renderer).toContain("StoryWallpaper");
    expect(renderer).toContain("MomentWallpaper");
    expect(renderer).not.toContain("deviceSize.width");
  });

  it("draws OS furniture over the device preview", () => {
    /**
     * The reason the device mode is worth building. §4's safe zones are
     * reasoned numbers that have never been checked on hardware, and a flat
     * preview looks fine even when the lock-screen clock lands on someone's
     * face.
     */
    for (const element of ["lockClock", "homeIndicator", "dock", "iconColumn"]) {
      expect(modes).toContain(element);
    }
  });

  it("uses logical properties in the mockups", () => {
    // §15 — an Arabic desktop puts its icon column on the other side.
    const css = readFileSync("src/components/studio/preview/preview-modes.module.css", "utf8");
    expect(css).toContain("inset-inline-start");
    expect(css).not.toMatch(/^\s+left:/m);
  });
});

describe("the Live pack preview (§16)", () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const renderer = strip(readFileSync("src/components/studio/preview/component-renderer.tsx", "utf8"));
  const timelineIndex = readFileSync("src/lib/studio/product-modules/love-story-timeline/index.ts", "utf8");
  const livePreviewAdapter = readFileSync("src/lib/studio/product-modules/love-story-timeline/live-preview.tsx", "utf8");

  it("is a real interactive component, not another static image mode", () => {
    // §16 is explicit: Live must not be "just another static poster
    // preview." The adapter renders the SAME component the purchased
    // /live/<id> page renders.
    expect(livePreviewAdapter).toContain("LiveKeepsake");
  });

  it("reuses LiveKeepsake rather than building a second live-preview stack", () => {
    // "If an existing architecture can be reused, prefer it" — LiveKeepsake
    // needs no order and no entitlement, so it doubles as a pre-purchase
    // Studio preview with zero server round-trip.
    expect(livePreviewAdapter).not.toContain("fetch(");
    expect(livePreviewAdapter).not.toContain("/api/");
  });

  it("only Love Story Timeline opts in — no product id hardcoded in the shared shell", () => {
    /**
     * Where We Met Map has no Digital pack concept and must never see a
     * fourth tab it has nothing to show for. The mechanism is a config
     * flag the module itself sets (`livePreview`), the same pattern
     * already used for `hideCustomerFacingList` — not a product-slug
     * check inside the shared `ComponentRenderer` or `PreviewModeTabs`.
     */
    expect(timelineIndex).toContain("livePreview:");
    expect(renderer).not.toContain('"love-story-timeline"');
    expect(renderer).not.toContain("productId ===");
  });

  it("skips ScaleToFit, the export ref and the watermark for the live mode", () => {
    /**
     * Three things that make sense for a static image and none for a
     * scrolling page: forcing it into a fixed poster-shaped box, wiring it
     * to a rasterizer that will never capture it, and a fixed watermark
     * that would just sit oddly over content scrolling past it — §20's
     * watermark protects a static image from being screenshotted before
     * purchase, which is not the same threat model as an interactive page.
     */
    const liveBranch = renderer.slice(
      renderer.indexOf('mode === "live" && LivePreview'),
      renderer.indexOf(": mode === \"framed\"")
    );
    expect(liveBranch).not.toContain("ScaleToFit");
    expect(liveBranch).not.toContain("PreviewWatermark");
    expect(liveBranch).not.toContain("registerExportTarget");
  });

  it("builds resolved URLs from Studio state rather than re-uploading anything", () => {
    // Milestone video/audio already have a `.url` from when they were
    // added during editing (§7). Background music is different — §4 made
    // it a shipped preset id, not a customer upload, so it resolves
    // through `presetMusicUrl`, never `.url`.
    expect(livePreviewAdapter).toContain(".video?.url");
    expect(livePreviewAdapter).toContain(".audio?.url");
    expect(livePreviewAdapter).toContain("presetMusicUrl(values.backgroundMusic)");
  });
});

describe("mockup sizing chain (found while investigating a reported overflow bug)", () => {
  const css = readFileSync("src/components/studio/preview/preview-modes.module.css", "utf8");

  /**
   * `ScaleToFit`'s own wrapper needs `h-full w-full` (height/width: 100%)
   * to resolve to a concrete pixel size, which CSS only does when EVERY
   * ancestor in the chain has an explicit (non-auto) height. Before this
   * fix, `.wall`/`.frame`/`.mat`/`.device`/`.screen` were sized only by
   * percentage padding and their own content — which is not the same
   * thing, and silently left `h-full` unable to resolve. The measured
   * effect: ScaleToFit's scale calculation got 0/NaN, its own fallback
   * set scale to 1, and the artwork rendered at full intrinsic size
   * instead of shrinking to fit the panel — reported as the mockup
   * bursting past the preview area's borders.
   *
   * This cannot verify the visual fix — no real browser is available to
   * actually measure computed layout in this environment. It verifies the
   * one property whose absence caused it, so it cannot be silently
   * reintroduced by a future edit that "simplifies" this CSS.
   */
  it.each(["wall", "frame", "mat", "device", "screen"])(
    "%s has an explicit height and width, not just padding",
    (className) => {
      const block = css.slice(css.indexOf(`.${className} {`));
      const rule = block.slice(0, block.indexOf("}"));
      expect(rule).toMatch(/height:\s*100%/);
      expect(rule).toMatch(/width:\s*100%/);
    }
  );

  it("gives each device kind its own shape, not a stretched rectangle", () => {
    // .screen filling .device only looks right if .device itself has a
    // real phone/tablet/desktop shape — otherwise "phone" and "desktop"
    // would collapse to whatever rectangle the Studio panel happens to be.
    expect(css).toMatch(/\.phone\s*{[^}]*aspect-ratio/);
    expect(css).toMatch(/\.tablet\s*{[^}]*aspect-ratio/);
    expect(css).toMatch(/\.desktop\s*{[^}]*aspect-ratio/);
  });
});
