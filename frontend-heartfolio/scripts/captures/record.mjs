#!/usr/bin/env node
/**
 * The storefront's product captures: muted loops and stills of each product's
 * REAL live page, with fictional sample content, in en/fr/ar.
 *
 *   node scripts/captures/record.mjs all            every stage below, in order
 *   node scripts/captures/record.mjs samples        Studio samples -> backend/.../samples.json
 *   node scripts/captures/record.mjs bundle         backend builds the payloads, prints, QR cards
 *   node scripts/captures/record.mjs record         record the loops (needs the capture server)
 *   node scripts/captures/record.mjs stills         prints and QR cards -> public/captures
 *   node scripts/captures/record.mjs sheet          contact sheet -> .captures-work/contact-sheet.jpg
 *   options: --base http://localhost:3005  --product <slug>  --locale <en|fr|ar>
 *
 * REGENERATE ONLY WHEN A PRODUCT CHANGES (owner's decision); the results are
 * committed in `public/captures/` with `manifest.json`, which
 * `src/lib/captures/captures.test.ts` checks.
 *
 * Needs: Docker (`api` and the throwaway `db` running; the backend step and
 * the video encoder run there, against the throwaway database only), Python
 * (to unzip the bundle), an installed Chrome, and for `record` the capture
 * server: `HEARTFOLIO_CAPTURE=1 npm run dev -- --port 3005` (or the
 * `frontend-capture` entry in `.claude/launch.json`).
 *
 * HOW A LOOP IS RECORDED, and why it is smooth on any machine: time in the page
 * is frozen (Playwright's clock: timers, requestAnimationFrame, Date), and every
 * web animation is paused; then, for each frame, the clock and every animation
 * advance by exactly 1/30 s and the page is photographed. A slow screenshot
 * never drops a frame, and two runs give the same frames. The cookie banner
 * is pre-answered, Next's dev badge hidden, `Math.random` seeded, and YouTube
 * replaced by a stub player (the sample's video id is fake on purpose).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = resolve(ROOT, "..");
const WORK = join(ROOT, ".captures-work");
const OUT = join(ROOT, "public", "captures");

const PRODUCTS = ["love-story-timeline", "reasons-i-love-you", "graduation-keepsake", "song-poster"];
const PRINTABLE = new Set(["love-story-timeline", "song-poster"]);
const LOCALES = ["en", "fr", "ar"];

const FPS = 30;
const VIEWPORT = { width: 390, height: 844 };
/** The loop's encoded width; the phone frame shows it at about 300px CSS. */
const VIDEO_WIDTH = 600;
/** A fixed "today", so dates such as Love Story Timeline's duration repeat. */
const FIXED_NOW = new Date("2026-06-01T10:00:00Z").getTime();

const args = process.argv.slice(2);
const stage = args.find((a) => !a.startsWith("--")) ?? "all";
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const BASE = option("base", "http://localhost:3005");
const onlyProduct = option("product");
const onlyLocale = option("locale");
const products = onlyProduct ? [onlyProduct] : PRODUCTS;
const locales = onlyLocale ? [onlyLocale] : LOCALES;

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, { stdio: ["pipe", "pipe", "inherit"], maxBuffer: 1 << 30, ...opts });
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} failed (${result.status})`);
  return result.stdout;
}

const COMPOSE = ["compose", "-f", join(REPO, "docker-compose.yml")];
const THROWAWAY = ["-e", "DATABASE_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio", "-e", "ASSET_STORAGE_BACKEND=mock"];

/* ---------------------------------------------------------------- samples */

function stageSamples() {
  run(process.execPath, [
    "--import", "./scripts/captures/css-stub-loader.mjs",
    "node_modules/jiti/lib/jiti-cli.mjs", "scripts/captures/export-samples.ts",
  ], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, JITI_JSX: "1", JITI_ALIAS: JSON.stringify({ "@": join(ROOT, "src") }) },
  });
}

/* ----------------------------------------------------------------- bundle */

function stageBundle() {
  mkdirSync(WORK, { recursive: true });
  const zip = run("docker", [
    ...COMPOSE, "exec", "-T", ...THROWAWAY, "api",
    "python", "manage.py", "render_marketing_samples", "--stdout",
  ]);
  const zipPath = join(WORK, "bundle.zip");
  writeFileSync(zipPath, zip);
  for (const dir of ["payloads", "assets", "prints", "qr"]) rmSync(join(WORK, dir), { recursive: true, force: true });
  run("python", ["-m", "zipfile", "-e", zipPath, WORK], { stdio: "inherit" });
  console.log(`bundle: ${zip.length} bytes unpacked into .captures-work/`);
}

/* ----------------------------------------------------------------- record */

/** Runs in the page before any of its scripts. */
function pageSetup({ seed }) {
  try {
    localStorage.setItem("heartfolio-analytics-consent", "denied");
  } catch {}
  // Seeded randomness: sparkles and confetti land in the same places each run.
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Next's dev badge is not part of the product.
  const hide = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(style);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide);
  // A stand-in for YouTube's player: ready at once, a 3:34 song that starts
  // 0:47 in, so the progress bar is visibly part-way when it plays.
  const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  class Player {
    constructor(_el, options) {
      this.options = options;
      this.state = PlayerState.UNSTARTED;
      this.position = 47;
      setTimeout(() => options.events?.onReady?.({ target: this }), 30);
    }
    emit(state) {
      this.state = state;
      this.options.events?.onStateChange?.({ target: this, data: state });
    }
    playVideo() {
      this.since = performance.now();
      this.emit(PlayerState.PLAYING);
    }
    pauseVideo() {
      this.position = this.getCurrentTime();
      this.emit(PlayerState.PAUSED);
    }
    stopVideo() {
      this.pauseVideo();
    }
    seekTo(seconds) {
      this.position = seconds;
      this.since = performance.now();
    }
    getCurrentTime() {
      return this.state === PlayerState.PLAYING ? this.position + (performance.now() - this.since) / 1000 : this.position;
    }
    getDuration() {
      return 214;
    }
    getPlayerState() {
      return this.state;
    }
    destroy() {}
  }
  window.YT = { Player, PlayerState };
}

/** Freezes every running animation and advances the ones it froze, so CSS
 *  and Web Animations move exactly with the frozen clock. */
async function step(page, ms) {
  await page.clock.runFor(ms);
  await page.evaluate((dt) => {
    const held = (window.__captureHeld ??= new WeakSet());
    for (const animation of document.getAnimations()) {
      if (animation.playState === "running") {
        animation.pause();
        held.add(animation);
      } else if (held.has(animation) && animation.playState === "paused" && animation.currentTime !== null) {
        // A held animation never resolves `finished` (scenes wait on it), so
        // one that reaches its end is finished explicitly.
        const next = Number(animation.currentTime) + dt;
        const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
        if (Number.isFinite(end) && next >= end) animation.finish();
        else animation.currentTime = next;
      }
    }
  }, ms);
}

/** Song Poster's play button, by its label in each language
 *  (`player-copy.ts`). */
const PLAY_LABEL = { en: "Play", fr: "Lecture", ar: "تشغيل" };

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

async function scrollTo(page, y) {
  await page.evaluate((top) => (document.scrollingElement ?? document.documentElement).scrollTo(0, top), y);
}

/** Clicks an element's centre. Playwright's own `click()` waits for the
 *  element to be "stable", measured with animation frames, which never come
 *  while the clock is frozen. */
async function press(page, locator) {
  const box = await locator.boundingBox({ timeout: 10_000 });
  if (!box) throw new Error("nothing to press");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * One scenario per product: `prepare` runs off camera; `frames` is the loop's
 * length; `at(i)` acts on frame i. The last frame is the still (poster).
 */
const SCENARIOS = {
  // The opening (names, title, first photo), then a slow scroll to the
  // second milestone as it reveals itself.
  "love-story-timeline": {
    frames: 7 * FPS,
    // A scrolling page compresses worst of the four: a little more
    // compression keeps it under the 600 KB budget.
    crf: 32,
    async prepare() {},
    async at(page, i, ctx) {
      const start = Math.round(3.5 * FPS);
      if (i === start) {
        ctx.from = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTop);
        ctx.to = await page.evaluate(() => {
          // [0] is the opening's glimpse of the first photo, [1] the first
          // milestone's, [2] the second's: stop with its title in view.
          const photos = [...document.querySelectorAll("img")].filter((img) => img.src.includes("/capture-assets/"));
          const rect = photos[2].getBoundingClientRect();
          return Math.max(0, window.scrollY + rect.top - 300);
        });
      }
      if (i >= start && ctx.to !== undefined) {
        const p = Math.min(1, (i - start) / (3 * FPS));
        await scrollTo(page, ctx.from + (ctx.to - ctx.from) * easeInOut(p));
      }
    },
  },
  // The jar; a tap; a note unfolds with its photo. Reason one (text only) is
  // drawn and put back off camera, so the note on camera is reason two.
  "reasons-i-love-you": {
    frames: 6 * FPS,
    async prepare(page) {
      for (let i = 0; i < 2 * FPS; i++) await step(page, 1000 / FPS);
      await tapJar(page);
      for (let i = 0; i < 2 * FPS; i++) await step(page, 1000 / FPS);
      await page.mouse.click(VIEWPORT.width / 2, 120);
      for (let i = 0; i < 2 * FPS; i++) await step(page, 1000 / FPS);
    },
    async at(page, i) {
      if (i === Math.round(1.2 * FPS)) await tapJar(page);
    },
  },
  // The boarding pass, torn; the window opens on the graduate.
  "graduation-keepsake": {
    frames: Math.round(5.5 * FPS),
    async prepare(page) {
      for (let i = 0; i < 2 * FPS; i++) await step(page, 1000 / FPS);
    },
    async at(page, i) {
      if (i === Math.round(1.5 * FPS)) await press(page, page.locator("button", { hasText: "✂" }).first());
    },
  },
  // The poster comes in; play; the soundwave starts to move.
  "song-poster": {
    frames: 6 * FPS,
    async prepare() {},
    async at(page, i, ctx) {
      if (i === Math.round(2 * FPS)) await press(page, page.locator(`button[aria-label="${PLAY_LABEL[ctx.locale]}"]`).first());
    },
  },
};

/** The gift scene's own button (jar, daisy, deck or cookies), which the
 *  scenes mark with `data-part`. Waits for it, stepping the frozen clock. */
async function tapJar(page) {
  const scene = page.locator("button[data-part]").first();
  for (let i = 0; i < 5 * FPS && (await scene.count()) === 0; i++) await step(page, 1000 / FPS);
  await press(page, scene);
}

/** Fonts, and the images the browser is actually fetching. Lazy images below
 *  the fold never start loading, so they are not waited for. The 20s cap is
 *  kept here in Node: the page's own timers are frozen. */
async function waitForImages(page) {
  const loaded = page.evaluate(async () => {
    await document.fonts.ready;
    const pending = [...document.images].filter((img) => !img.complete && img.loading !== "lazy");
    await Promise.all(pending.map((img) => new Promise((r) => {
      img.addEventListener("load", r, { once: true });
      img.addEventListener("error", r, { once: true });
    })));
  });
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 20_000))]);
}

function encode(framesDir, outFile, crf = 30) {
  const frames = readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).sort();
  const stream = Buffer.concat(frames.map((f) => readFileSync(join(framesDir, f))));
  run("docker", [
    ...COMPOSE, "exec", "-T", "api", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-vf", `scale=${VIDEO_WIDTH}:-2:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(crf),
    "-movflags", "+faststart", "-an", "/tmp/heartfolio-capture.mp4",
  ], { input: stream });
  run("docker", [...COMPOSE, "cp", "api:/tmp/heartfolio-capture.mp4", outFile]);
  run("docker", [...COMPOSE, "exec", "-T", "api", "rm", "-f", "/tmp/heartfolio-capture.mp4"]);
}

async function writeStill(source, base, width, { avifQuality = 50, jpegQuality = 80 } = {}) {
  const image = sharp(source).resize({ width, withoutEnlargement: true });
  await image.clone().avif({ quality: avifQuality, effort: 6 }).toFile(`${base}.avif`);
  await image.clone().jpeg({ quality: jpegQuality, mozjpeg: true }).toFile(`${base}.jpg`);
}

async function stageRecord() {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const product of products) {
      for (const locale of locales) {
        const scenario = SCENARIOS[product];
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale });
        await context.addInitScript(pageSetup, { seed: 20261026 });
        const page = await context.newPage();
        await page.clock.install({ time: FIXED_NOW });
        await page.clock.pauseAt(FIXED_NOW + 1000);
        const url = `${BASE}/${locale}/capture/${product}`;
        const response = await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        if (!response || response.status() !== 200) throw new Error(`${url}: ${response?.status()} (is the capture server running?)`);
        await waitForImages(page);
        await scenario.prepare(page);

        const framesDir = join(WORK, "frames", `${product}.${locale}`);
        rmSync(framesDir, { recursive: true, force: true });
        mkdirSync(framesDir, { recursive: true });
        const ctx = { locale };
        for (let i = 0; i < scenario.frames; i++) {
          await scenario.at(page, i, ctx);
          await step(page, 1000 / FPS);
          if (i % FPS === 0) await waitForImages(page);
          writeFileSync(join(framesDir, `f${String(i).padStart(4, "0")}.jpg`), await page.screenshot({ type: "jpeg", quality: 92 }));
        }
        await context.close();

        const dir = join(OUT, locale);
        mkdirSync(dir, { recursive: true });
        encode(framesDir, join(dir, `${product}.mp4`), scenario.crf);
        const last = readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).sort().pop();
        await writeStill(join(framesDir, last), join(dir, `${product}`), VIDEO_WIDTH);
        console.log(`recorded ${locale}/${product}`);
      }
    }
  } finally {
    await browser.close();
  }
}

/* ----------------------------------------------------------------- stills */

async function stageStills() {
  for (const product of products) {
    for (const locale of locales) {
      const dir = join(OUT, locale);
      mkdirSync(dir, { recursive: true });
      if (PRINTABLE.has(product)) {
        await writeStill(join(WORK, "prints", `${product}.${locale}.png`), join(dir, `${product}-print`), 900);
      }
      // Higher quality: the QR must stay scannable at any size it is shown.
      await writeStill(join(WORK, "qr", `${product}.${locale}.png`), join(dir, `${product}-qr`), 600, { avifQuality: 70, jpegQuality: 90 });
    }
  }
  await writeManifest();
}

/* --------------------------------------------------------------- manifest */

function fileEntry(path) {
  return existsSync(path) ? { src: `/${path.slice(join(ROOT, "public").length + 1).replaceAll("\\", "/")}`, bytes: statSync(path).size } : null;
}

async function stillEntry(base) {
  const avif = fileEntry(`${base}.avif`);
  const jpg = fileEntry(`${base}.jpg`);
  if (!avif || !jpg) return null;
  const { width, height } = await sharp(`${base}.jpg`).metadata();
  return { avif, jpg, width, height };
}

/** Everything the pages need to reserve space and choose a file: sizes in
 *  pixels, bytes (budgets are checked by `src/lib/captures/captures.test.ts`)
 *  and each loop's length. */
async function writeManifest() {
  const manifest = { generated: new Date().toISOString().slice(0, 10), fps: FPS, products: {} };
  for (const product of PRODUCTS) {
    manifest.products[product] = {};
    for (const locale of LOCALES) {
      const base = join(OUT, locale, product);
      const poster = await stillEntry(base);
      const loop = fileEntry(`${base}.mp4`);
      manifest.products[product][locale] = {
        loop: loop && poster ? { ...loop, width: poster.width, height: poster.height, seconds: SCENARIOS[product].frames / FPS } : null,
        poster,
        print: PRINTABLE.has(product) ? await stillEntry(`${base}-print`) : null,
        qr: await stillEntry(`${base}-qr`),
      };
    }
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("manifest written");
}

/* ------------------------------------------------------------------ sheet */

/** A labelled grid: one row per product, one column per language. */
async function grid(rows, tileWidth, tileHeight, out) {
  const labelHeight = 30;
  const label = (text) =>
    Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#141b2e"/><text x="10" y="20" font-family="Arial" font-size="15" fill="#f7f1e6">${text}</text></svg>`);
  const composites = [];
  rows.forEach((row, r) => {
    row.forEach((tile, c) => {
      if (!tile || !existsSync(tile.file)) return;
      const top = r * (tileHeight + labelHeight);
      composites.push({ input: label(tile.text), left: c * tileWidth, top });
      composites.push({ file: tile.file, left: c * tileWidth, top: top + labelHeight });
    });
  });
  const inputs = await Promise.all(
    composites.map(async (item) =>
      item.file
        ? { input: await sharp(item.file).resize(tileWidth, tileHeight, { fit: "contain", background: "#ffffff" }).toBuffer(), left: item.left, top: item.top }
        : item
    )
  );
  await sharp({ create: { width: tileWidth * LOCALES.length, height: rows.length * (tileHeight + labelHeight), channels: 3, background: "#ffffff" } })
    .composite(inputs)
    .jpeg({ quality: 85 })
    .toFile(out);
  console.log(`contact sheet: ${out}`);
}

async function stageSheet() {
  const tile = (locale, name, text) => ({ file: join(OUT, locale, `${name}.jpg`), text });
  // 1. The loops' stills (each loop's last frame): what the cards will show.
  await grid(
    PRODUCTS.map((product) => LOCALES.map((locale) => tile(locale, product, `${product} · ${locale}`))),
    300, 650, join(WORK, "contact-sheet.jpg")
  );
  // 2. The prints and the gift QR cards.
  await grid(
    [
      ...[...PRINTABLE].map((product) => LOCALES.map((locale) => tile(locale, `${product}-print`, `${product} print · ${locale}`))),
      ...PRODUCTS.map((product) => LOCALES.map((locale) => tile(locale, `${product}-qr`, `${product} QR · ${locale}`))),
    ],
    300, 380, join(WORK, "contact-sheet-prints-qr.jpg")
  );
}

/* ------------------------------------------------------------------- main */

const STAGES = { samples: stageSamples, bundle: stageBundle, record: stageRecord, stills: stageStills, sheet: stageSheet };
const order = stage === "all" ? ["samples", "bundle", "record", "stills", "sheet"] : [stage];
for (const name of order) {
  if (!STAGES[name]) throw new Error(`unknown stage ${name}`);
  console.log(`== ${name}`);
  await STAGES[name]();
}
