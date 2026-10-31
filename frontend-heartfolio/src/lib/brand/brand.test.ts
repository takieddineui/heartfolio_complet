import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { backendRoot } from "../../../test/backend-root";
import { MARK_GRADIENTS, MARK_STROKES, SPARK_PATH, WORDMARK } from "./mark";

/**
 * ONE LOGO SOURCE (owner, 31 Oct 2026). The QR cards and the PDFs drew their
 * own copies of the mark, and both had drifted from the site's. Now:
 * - `lib/brand/mark.ts` and `src/app/icon.svg` are the mark, pinned together;
 * - the backend pastes `apps/delivery/brand/mark.png`, which must be exactly
 *   `icon.svg` as `scripts/brand/render-mark.mjs` renders it;
 * - the wordmark everywhere is the site's (`WORDMARK`), in the site's own
 *   font files;
 * - no other file carries the mark's geometry.
 */
const SRC = join(process.cwd(), "src");
const ICON = readFileSync(join(SRC, "app/icon.svg"), "utf8");
const LOCKUP = readFileSync(join(process.cwd(), "public/assets/logo-full.svg"), "utf8");
const BRAND = join(backendRoot(), "apps/delivery/brand");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the mark", () => {
  it("icon.svg and the full lockup draw exactly the shared strokes, in the shared order, and the spark", () => {
    for (const [name, svg] of [["icon.svg", ICON], ["logo-full.svg", LOCKUP]] as const) {
      const drawn = [...svg.matchAll(/<path stroke="url\(#([\w-]+)\)" d="([^"]+)"/g)].map((m) => ({ id: m[1]!, d: m[2]! }));
      expect(drawn.map((p) => p.d), name).toEqual(MARK_STROKES.map((s) => s.d));
      expect(drawn.map((p) => p.id.endsWith("over")), name).toEqual(MARK_STROKES.map((s) => s.paint === "over"));
      expect(svg, name).toContain(`d="${SPARK_PATH}"`);
    }
  });

  it("icon.svg's gradients are the shared ones", () => {
    for (const [key, id] of [["ribbon", "hf-ribbon"], ["over", "hf-ribbon-over"], ["spark", "hf-spark"]] as const) {
      const block = new RegExp(`<linearGradient id="${id}"[^>]*>([\\s\\S]*?)</linearGradient>`).exec(ICON)!;
      const g = MARK_GRADIENTS[key];
      expect(block[0]).toContain(`x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"`);
      const stops = [...block[1]!.matchAll(/offset="([\d.]+)" stop-color="(#[0-9A-Fa-f]{6})"/g)].map((m) => [Number(m[1]), m[2]!.toUpperCase()]);
      expect(stops, key).toEqual(g.stops.map(([o, c]) => [o, c.toUpperCase()]));
    }
  });

  it("the backend's master PNG is icon.svg, rendered again here, pixel for pixel", async () => {
    // @ts-expect-error: a plain .mjs script with no type declarations.
    const { renderMark, MARK_MASTER_PX } = await import("../../../scripts/brand/render-mark.mjs");
    const fresh = await sharp(await renderMark()).raw().toBuffer({ resolveWithObject: true });
    const committed = await sharp(readFileSync(join(BRAND, "mark.png"))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([committed.info.width, committed.info.height]).toEqual([MARK_MASTER_PX, MARK_MASTER_PX]);
    expect(committed.data.length).toBe(fresh.data.length);
    let worst = 0;
    for (let i = 0; i < fresh.data.length; i++) worst = Math.max(worst, Math.abs(fresh.data[i]! - committed.data[i]!));
    expect(worst, "run node scripts/brand/render-mark.mjs").toBeLessThanOrEqual(2);
  });

  it("the receipt email's mark is icon.svg too, at the path the email links", async () => {
    // @ts-expect-error: a plain .mjs script with no type declarations.
    const { renderMark, EMAIL_MARK_PX } = await import("../../../scripts/brand/render-mark.mjs");
    const emails = readFileSync(join(backendRoot(), "apps/commerce/emails.py"), "utf8");
    const path = /^EMAIL_MARK_PATH = "([^"]+)"/m.exec(emails)?.[1];
    expect(path).toBe("/brand/heartfolio-mark.png");
    const fresh = await sharp(await renderMark(EMAIL_MARK_PX)).raw().toBuffer();
    const committed = await sharp(readFileSync(join(process.cwd(), "public", path!))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([committed.info.width, committed.info.height]).toEqual([EMAIL_MARK_PX, EMAIL_MARK_PX]);
    let worst = 0;
    for (let i = 0; i < fresh.length; i++) worst = Math.max(worst, Math.abs(fresh[i]! - committed.data[i]!));
    expect(worst, "run node scripts/brand/render-mark.mjs").toBeLessThanOrEqual(2);
  });

  it("no other file in the frontend or the backend carries the mark's geometry", () => {
    const allowed = new Set(["lib/brand/mark.ts", "lib/brand/brand.test.ts", "app/icon.svg"]);
    const pieces = [SPARK_PATH, ...MARK_STROKES.map((s) => s.d)];
    const offenders = files(SRC)
      .filter((path) => /\.(tsx?|css|svg|mjs)$/.test(path))
      .map((path) => relative(SRC, path).replaceAll("\\", "/"))
      .filter((path) => !allowed.has(path))
      .filter((path) => pieces.some((piece) => readFileSync(join(SRC, path), "utf8").includes(piece)));
    expect(offenders).toEqual([]);
    // The backend: `apps/delivery/tests_brand.py` scans it for the same
    // geometry in Python's own spellings.
  });
});

describe("the wordmark", () => {
  it("the backend draws the site's: the same word, weight and tracking", () => {
    const python = readFileSync(join(BRAND, "__init__.py"), "utf8");
    expect(python).toContain(`WORDMARK_TEXT = "${WORDMARK.text}"`);
    expect(python).toContain(`WORDMARK_WEIGHT = ${WORDMARK.weight}`);
    expect(python).toContain(`WORDMARK_TRACKING_EM = ${WORDMARK.trackingEm}`);
  });

  it("in the site's own font files, byte for byte, with their licences", () => {
    for (const file of ["fraunces-latin.woff2", "inter-latin.woff2", "LICENSE-fraunces.txt", "LICENSE-inter.txt"]) {
      const site = readFileSync(join(process.cwd(), "public/fonts", file));
      const backend = readFileSync(join(BRAND, "fonts", file));
      expect(backend.equals(site), file).toBe(true);
    }
  });

  it("the share cards' wordmark face is Fraunces at the site's weight", () => {
    const ttf = readFileSync(join(SRC, "assets/og-fonts/fraunces-400.ttf"));
    const tables = ttf.readUInt16BE(4);
    for (let i = 0; i < tables; i++) {
      const record = 12 + i * 16;
      if (ttf.toString("latin1", record, record + 4) === "OS/2") {
        const offset = ttf.readUInt32BE(record + 8);
        expect(ttf.readUInt16BE(offset + 4)).toBe(WORDMARK.weight);
        return;
      }
    }
    throw new Error("no OS/2 table");
  });

  it("the live intro and the share cards take the mark and the wordmark from the shared module", () => {
    const intro = readFileSync(join(SRC, "components/live/live-intro.tsx"), "utf8");
    expect(intro).toContain("MARK_STROKES.map");
    expect(intro).toContain("WORDMARK.text");
    const og = readFileSync(join(SRC, "lib/og.tsx"), "utf8");
    expect(og).toContain('"src/app/icon.svg"');
    expect(og).toContain("WORDMARK.text");
  });
});
