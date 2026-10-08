/**
 * Compiles the SHARED AR tracking target (§21i).
 *
 * A ONE-TIME BUILD STEP, run on a developer machine and committed. Not
 * something the server does: the shared card's artwork is identical for
 * every customer, so compiling it per request — or per order — would be
 * repeating the same work forever.
 *
 * Per-order cards are different and are compiled in the buyer's browser at
 * checkout; see `ar-target-compiler.tsx`. This script exists only for the
 * card whose artwork never changes.
 *
 * Usage:
 *   python manage.py shell -c "..." > card.png    # see README.md
 *   npm install && node compile.mjs card.png
 *   # → heartfolio-card.mind, to be placed in
 *   #   frontend/heartfolio/public/ar/targets/
 */
import { readFileSync, writeFileSync } from "node:fs";
import { OfflineCompiler } from "mind-ar/src/image-target/offline-compiler.js";
import { loadImage } from "canvas";

const input = process.argv[2];
if (!input) {
  console.error("usage: node compile.mjs <card.png>");
  process.exit(1);
}

const image = await loadImage(readFileSync(input));
const compiler = new OfflineCompiler();

await compiler.compileImageTargets([image], (percent) => {
  process.stdout.write(`\rcompiling… ${Math.round(percent)}%`);
});
process.stdout.write("\n");

const buffer = compiler.exportData();
writeFileSync("heartfolio-card.mind", Buffer.from(buffer));

console.log("wrote heartfolio-card.mind");
console.log(
  "Place it at frontend/heartfolio/public/ar/targets/heartfolio-card.mind — " +
    "the path SHARED_TARGET_URL in ar-scene.tsx expects."
);
