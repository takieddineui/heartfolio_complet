#!/usr/bin/env node
/**
 * Renders the site's mark (`src/app/icon.svg`) to the PNG every backend
 * deliverable pastes (`backend/apps/delivery/brand/mark.png`): the QR cards,
 * the gift card in the receipt email, the bonus PDFs. And to the small PNG
 * the receipt email shows at its top (`public/brand/heartfolio-mark.png`,
 * 144px for 48px on screen at 3x): email clients draw neither SVG nor
 * data: images, so the email links a PNG on the site.
 *
 *   node scripts/brand/render-mark.mjs
 *
 * 1024px for the 64-unit box: 16 pixels a unit, so the QR card's mark (160px)
 * and the PDFs' (14mm, about 1,860dpi) are both drawn DOWN from it, never up.
 * Run it whenever `icon.svg` changes; `src/lib/brand/brand.test.ts` renders
 * it again the same way and fails if the committed file differs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const MARK_MASTER_PX = 1024;
export const EMAIL_MARK_PX = 144;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function renderMark(size = MARK_MASTER_PX, svgPath = join(ROOT, "src/app/icon.svg")) {
  const svg = readFileSync(svgPath);
  // density: dots per inch for the SVG's 64 user units, as 64 CSS pixels.
  return sharp(svg, { density: (72 * size) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = [
    [join(ROOT, "..", "backend", "apps", "delivery", "brand", "mark.png"), MARK_MASTER_PX],
    [join(ROOT, "public", "brand", "heartfolio-mark.png"), EMAIL_MARK_PX],
  ];
  for (const [out, size] of outputs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await renderMark(size));
    console.log(`wrote ${out}`);
  }
}
