/**
 * Regenerates the raster icons from `src/app/icon.svg`.
 *
 *   node scripts/generate-icons.mjs
 *
 * WHY A SCRIPT RATHER THAN HAND-EXPORTED FILES: the SVG is the source.
 * Exported PNGs drift the moment the mark is touched and nothing warns
 * you — the favicon simply stays the old logo for months. Re-run this
 * after any edit to icon.svg, and commit the output.
 *
 * WHY THESE SIZES:
 *   192 / 512   required by the web manifest; Android silently declines to
 *               offer installation without real rasters at both.
 *   180         apple-touch-icon. iOS ignores SVG favicons entirely.
 *   32          the classic desktop fallback, for browsers and feed readers
 *               that will not take an SVG.
 *
 * THE DARK PLATE IS DELIBERATE. These composite onto a rounded dark
 * background because a bare rose-gold mark vanishes against a white home
 * screen or a light tab strip. The SVG favicon stays transparent — modern
 * browsers prefer it and theme it themselves.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, "src/app/icon.svg");
const PLATE = "#141B2E"; // --ink-navy, the plate the previous icon used.

const TARGETS = [
  { out: "public/icon-192.png", size: 192, padding: 0.14 },
  { out: "public/icon-512.png", size: 512, padding: 0.14 },
  { out: "src/app/apple-icon.png", size: 180, padding: 0.12 },
  { out: "public/favicon-32x32.png", size: 32, padding: 0.06 },
];

for (const { out, size, padding } of TARGETS) {
  const inner = Math.round(size * (1 - padding * 2));
  const offset = Math.round((size - inner) / 2);

  // Rasterised AT the final size, not scaled down from one large render:
  // the mark has thin strokes, and downsampling softens them to mush at 32px.
  const mark = await sharp(SOURCE, { density: 1024 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const composed = await sharp({
    create: { width: size, height: size, channels: 4, background: PLATE },
  })
    .composite([{ input: mark, top: offset, left: offset }])
    .png()
    .toBuffer();

  const target = resolve(ROOT, out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, composed);
  console.log(`wrote ${out} (${size}x${size})`);
}
