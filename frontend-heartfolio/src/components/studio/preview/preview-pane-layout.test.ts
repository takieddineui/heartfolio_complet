import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PREVIEW COLUMN MAY SHRINK BELOW ITS CANVAS.
 *
 * The column `PreviewPane` renders is a flex item. With the default
 * `min-width: auto`, a fixed-size canvas wider than the pane (Song Poster's
 * 1200px Award and Sleeve) stretched it, so `ScaleToFit` measured the canvas
 * instead of the pane: the poster ran 238px off screen at 1280 and was still
 * off at 1440, and on a phone the whole Studio grew wider than the screen
 * (833px on a 375px phone for Song Poster, 572px for Love Story Timeline).
 * Found and fixed 19 Oct 2026, verified in the browser at 1280, 1440, 1920
 * and phone width.
 *
 * jsdom has no layout, so this pins the rule itself.
 */
const source = readFileSync(join(__dirname, "preview-pane.tsx"), "utf8");

describe("the preview column", () => {
  it("is allowed to shrink below its canvas (min-w-0), so the canvas is scaled to fit", () => {
    const column = source.match(/<div className="([^"]*\bflex-1\b[^"]*)">\s*\{Renderer/);
    expect(column, "PreviewPane's column div").not.toBeNull();
    expect(column![1]!.split(/\s+/)).toContain("min-w-0");
  });
});
