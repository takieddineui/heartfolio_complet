import { createRequire } from 'module'; const require = createRequire('/opt/node-tools/node_modules/package.json'); const { chromium } = require('playwright');
// Probe each real Live experience to understand structure before capturing.


const BASE = 'http://localhost:3000';
const PRODUCTS = ['love-story-timeline', 'song-poster', 'reasons-i-love-you', 'graduation-keepsake'];

const browser = await chromium.launch();
for (const product of PRODUCTS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
  const url = `${BASE}/en/capture/${product}`;
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => ({ status: () => 'ERR ' + e.message.slice(0,60) }));
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"], a[href]')].slice(0, 40)
      .map(b => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().replace(/\s+/g,' ').slice(0, 40))
      .filter(Boolean);
    return {
      scrollH: document.documentElement.scrollHeight,
      viewportH: window.innerHeight,
      imgs: document.images.length,
      imgsLoaded: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length,
      videos: document.querySelectorAll('video').length,
      iframes: document.querySelectorAll('iframe').length,
      buttonCount: document.querySelectorAll('button,[role="button"]').length,
      sampleControls: [...new Set(buttons)].slice(0, 16),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
    };
  });
  console.log(`\n=== ${product} (HTTP ${resp.status ? resp.status() : '?'}) ===`);
  console.log(JSON.stringify(info, null, 1));
  if (errors.length) console.log('console errors:', errors.slice(0, 4));
  await ctx.close();
}
await browser.close();
