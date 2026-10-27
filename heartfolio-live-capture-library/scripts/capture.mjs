// Capture the REAL Heartfolio Live experiences (rendered by the dev capture
// page with the backend's own sample payloads) at mobile + desktop, with
// meaningful interaction states. No fabricated UI.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/package.json');
const { chromium } = require('playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const OUT = '/home/user/heartfolio_complet/heartfolio-live-capture-library';
const LOCALES = ['en', 'fr', 'ar'];
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const ONLY_PRODUCT = process.env.ONLY_PRODUCT;   // optional filter
const ONLY_LOCALE = process.env.ONLY_LOCALE;

const manifest = [];
function record(row) { manifest.push(row); }

async function setup(page) {
  // hide the Next.js dev-tools overlay (debug UI, not part of the product)
  await page.addStyleTag({ content:
    'nextjs-portal,[data-nextjs-toast],#__next-build-watcher,[data-next-mark]{display:none!important}'
  }).catch(() => {});
  // consent was pre-denied via addInitScript, so the banner should be gone;
  // click a decline control as a fallback if it somehow rendered
  for (const label of ['No thanks', 'Decline', 'Reject', 'Non merci', 'لا، شكرًا']) {
    const b = page.getByRole('button', { name: label });
    if (await b.count().catch(() => 0)) { await b.first().click().catch(() => {}); break; }
  }
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(500);
}

const CONSENT_INIT = () => { try { localStorage.setItem('heartfolio-analytics-consent', 'denied'); } catch (e) {} };

async function waitImages(page) {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(imgs.map(i => i.complete && i.naturalWidth > 0 ? null :
      new Promise(r => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 4000); })));
  }).catch(() => {});
}

async function scrollWindow(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 220));
    }
    window.scrollTo(0, 0);
  });
  await waitImages(page);
  await page.waitForTimeout(500);
}

async function shoot(page, product, locale, name, { fullPage = false } = {}) {
  const dir = join(OUT, product, 'scenario-01', locale);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  await page.screenshot({ path, fullPage });
  const vp = page.viewportSize();
  const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  record({ product, scenario: 'scenario-01', locale, file: path.replace(OUT + '/', ''),
    viewport: `${vp.width}x${vp.height}`, state: name.replace('.png', ''),
    page_dims: fullPage ? `${vp.width}x${dims.h}` : `${vp.width}x${vp.height}`, fullPage });
  return path;
}

// ---- per-product interaction routines (mobile) ----
async function states_lst(page, product, locale) {
  // opening overlay -> skip into the timeline
  const skip = page.getByRole('button', { name: /^Skip$/ });
  if (await skip.count().catch(() => 0)) await skip.first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shoot(page, product, locale, 'mobile-state-01-top.png');
  await scrollWindow(page);
  await shoot(page, product, locale, 'mobile-full-page.png', { fullPage: true });
  // open a milestone photo (lightbox) — locale-independent: the first
  // clickable element wrapping a milestone image
  const ph = page.locator('main button:has(img), button:has(img), [role="button"]:has(img)');
  if (await ph.count().catch(() => 0)) {
    await ph.first().scrollIntoViewIfNeeded().catch(() => {});
    await ph.first().click().catch(() => {});
    await page.waitForTimeout(900); await waitImages(page);
    await shoot(page, product, locale, 'mobile-state-02-photo-lightbox.png');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function states_song(page, product, locale) {
  await scrollWindow(page);
  await shoot(page, product, locale, 'mobile-full-page.png', { fullPage: true });
  await shoot(page, product, locale, 'mobile-state-01-poster.png');
}

async function states_reasons(page, product, locale) {
  await shoot(page, product, locale, 'mobile-state-01-initial.png');
  await shoot(page, product, locale, 'mobile-full-page.png', { fullPage: true });
  const jarName = /Tap the jar|Touchez le bocal|Ouvre|اضغط|افتح|الجرة|البرطمان|المس|الوعاء/;
  const open = page.getByRole('button', { name: jarName });
  if (await open.count().catch(() => 0)) {
    await open.first().click().catch(() => {});
    await page.waitForTimeout(1100);
    await shoot(page, product, locale, 'mobile-state-02-reason.png');
    // cycle jar -> reason -> back, up to ~8 times, to reach the finale reveal
    for (let i = 0; i < 9; i++) {
      // return to the jar (tap anywhere), then open the next reason
      await page.mouse.click(MOBILE.width / 2, MOBILE.height * 0.5).catch(() => {});
      await page.waitForTimeout(500);
      const jar = page.getByRole('button', { name: jarName });
      if (await jar.count().catch(() => 0)) {
        await jar.first().click().catch(() => {});
      } else {
        // no jar left — the finale (or letter) is showing
        await page.waitForTimeout(500);
        break;
      }
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(700); await waitImages(page);
    await shoot(page, product, locale, 'mobile-state-03-finale.png');
  }
}

async function findScroller(page) {
  return page.evaluateHandle(() => {
    let best = null, bestH = 0;
    for (const el of document.querySelectorAll('*')) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 200 && el.scrollHeight > bestH) {
        best = el; bestH = el.scrollHeight;
      }
    }
    return best;
  });
}

async function states_graduation(page, product, locale) {
  // the boarding pass / start screen
  await shoot(page, product, locale, 'mobile-state-01-start.png');
  // enter the journey
  const tear = page.getByRole('button', { name: /Tear to board|Déchirer pour embarquer|embarquer|مزّق للصعود|مزّق|الصعود/i });
  if (await tear.count().catch(() => 0)) { await tear.first().click().catch(() => {}); }
  await page.waitForTimeout(1600); await waitImages(page);
  const scroller = await findScroller(page);
  const hasScroller = await scroller.evaluate(el => !!el).catch(() => false);
  if (hasScroller) {
    // scroll the inner journey through, in steps, to trigger lazy content
    await scroller.evaluate(async (el) => {
      const step = el.clientHeight * 0.8;
      for (let y = 0; y <= el.scrollHeight; y += step) { el.scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); }
      el.scrollTo(0, 0);
    }).catch(() => {});
    await waitImages(page); await page.waitForTimeout(500);
    await scroller.evaluate(async (el) => { el.scrollTo(0, el.scrollHeight * 0.45); await new Promise(r => setTimeout(r, 700)); }).catch(() => {});
    await page.waitForTimeout(400);
    await shoot(page, product, locale, 'mobile-state-02-journey.png');
    await scroller.evaluate(async (el) => { el.scrollTo(0, el.scrollHeight); await new Promise(r => setTimeout(r, 800)); }).catch(() => {});
    await page.waitForTimeout(400);
    await shoot(page, product, locale, 'mobile-state-03-ending.png');
    // full-page: expand the inner scroller to its full height, capture, restore
    const restore = await scroller.evaluate((el) => {
      const prev = { h: el.style.height, mh: el.style.maxHeight, ov: el.style.overflow };
      el.scrollTo(0, 0);
      el.style.height = el.scrollHeight + 'px'; el.style.maxHeight = 'none'; el.style.overflow = 'visible';
      return prev;
    }).catch(() => null);
    await page.waitForTimeout(600); await waitImages(page);
    await shoot(page, product, locale, 'mobile-full-page.png', { fullPage: true });
    if (restore) await scroller.evaluate((el, p) => { el.style.height = p.h; el.style.maxHeight = p.mh; el.style.overflow = p.ov; }, restore).catch(() => {});
  } else {
    // no journey scroller found — keep the start screen as the full page
    await shoot(page, product, locale, 'mobile-full-page.png', { fullPage: true });
  }
}

const ROUTINES = {
  'love-story-timeline': states_lst,
  'song-poster': states_song,
  'reasons-i-love-you': states_reasons,
  'graduation-keepsake': states_graduation,
};

async function run() {
  const browser = await chromium.launch();
  const products = Object.keys(ROUTINES).filter(p => !ONLY_PRODUCT || p === ONLY_PRODUCT);
  const locales = LOCALES.filter(l => !ONLY_LOCALE || l === ONLY_LOCALE);
  for (const product of products) {
    for (const locale of locales) {
      // --- mobile ---
      const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2,
        locale: locale === 'ar' ? 'ar' : locale, reducedMotion: 'reduce' });
      await ctx.addInitScript(CONSENT_INIT);
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
      await page.goto(`${BASE}/${locale}/capture/${product}`, { waitUntil: 'networkidle', timeout: 60000 });
      await setup(page);
      await ROUTINES[product](page, product, locale);
      await ctx.close();
      // --- desktop full page ---
      const dctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1,
        locale: locale === 'ar' ? 'ar' : locale, reducedMotion: 'reduce' });
      await dctx.addInitScript(CONSENT_INIT);
      const dpage = await dctx.newPage();
      await dpage.goto(`${BASE}/${locale}/capture/${product}`, { waitUntil: 'networkidle', timeout: 60000 });
      await setup(dpage);
      const skip = dpage.getByRole('button', { name: /^Skip$/ });
      if (await skip.count().catch(() => 0)) await skip.first().click().catch(() => {});
      await scrollWindow(dpage);
      await shoot(dpage, product, locale, 'desktop-full-page.png', { fullPage: true });
      await dctx.close();
      console.log(`captured ${product} / ${locale}  (console errs: ${errs.length})`);
    }
  }
  await browser.close();
  mkdirSync(join(OUT, 'manifest'), { recursive: true });
  writeFileSync(join(OUT, 'manifest', 'capture_manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`\nTOTAL captures: ${manifest.length}`);
}
run();
