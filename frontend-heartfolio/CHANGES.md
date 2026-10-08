# Heartfolio — Landing, Product Pages, i18n, Legal & SEO

Verified with `npx tsc --noEmit` (clean), `npx eslint .` (clean) and
`npx next build` (passes; 61 static pages, including 12 product pages and
12 policy pages across `/en`, `/fr`, `/ar`).

Studio, checkout, Paddle, AR/VR, printing and the products API are all
untouched and out of scope, as briefed.

---

## 1. Bugs found and fixed

### Changing language reset dark mode to light (§23)

`<html>` is rendered by `app/[locale]/layout.tsx`. Changing locale changes
that segment's params, so React re-renders the root layout and re-applies
the element's attributes — wiping the `.dark` class, which had been added
imperatively by the no-flash script and was never part of any React tree.
The old `ThemeProvider` held the theme in `useState`, initialised once from
the DOM, so it never noticed the class had gone.

Theme now lives outside React (module state + `localStorage`, read through
`useSyncExternalStore`) and is re-applied to `<html>` after every render of
the provider. Locale and theme are fully independent; the choice survives
locale changes, navigation, refresh and reopening the site. Still exactly
one theme system.

### Locale detection used geo-IP, not the browser (§21, §22)

`proxy.ts` guessed language from `x-vercel-ip-country`: anyone outside a
hardcoded list of English-speaking countries got French, and Arabic was
unreachable by detection entirely. A visitor in Algeria with an English
browser was handed a French site; an Arabic speaker was never offered
Arabic.

Rewritten to read the q-weighted `Accept-Language` header only. Country is
ignored. Verified against a running server:

| Request | Result |
| --- | --- |
| `Accept-Language: ar-DZ,ar;q=0.9,fr;q=0.8` | `/ar` |
| `Accept-Language: fr-FR,fr;q=0.9,en;q=0.8` | `/fr` |
| `Accept-Language: en-US,en;q=0.9` | `/en` |
| Cookie `NEXT_LOCALE=en` + French browser | `/en` (choice wins) |

An explicit pick in the switcher writes the cookie, so detection never runs
again and never overrides it.

### Canonical URLs pointed at the wrong domain, and at the wrong page

Four files used `https://www.heartfolio.com`; the live site is
`theheartfolio.com`. Worse, every page in every locale declared
`canonical: "/"` — so `/fr/products/song-poster` claimed the English
homepage as its canonical. Both fixed: one `SITE_URL` constant, and
`buildAlternates()` gives each page a canonical pointing at itself in its
own locale plus a full hreflang set with `x-default`.

`localePrefix` is now `"always"`, so `/en` is a real URL and the three
locales are symmetrical.

### The site never loaded its own fonts

`globals.css` asked for Fraunces and Inter, but nothing loaded them — no
link, no `@font-face`, no `next/font`. Every visitor saw Georgia and the
system UI font. Now self-hosted through `next/font/local` from
`public/fonts`, with `display: swap` and metric-matched fallbacks.

Arabic gets its own pair (Noto Kufi for display, Noto Naskh for reading)
rather than a Latin face with a fallback, applied only on `/ar` so the other
locales pay nothing for them.

### Every share link previewed a missing image

Everything pointed at `/og-image.png`, which does not exist in the repo.
Each page now generates its own card at build time (`opengraph-image`
routes) — product name, its own line, its own starting price, brand colours
and typeface.

### Dead links and one fabricated testimonial

- Every footer link was `href="#"` or the homepage, **including Privacy and
  Terms**. That is a hard blocker for Paddle's merchant review.
- The header carried Search and Cart icons that did nothing; a cart icon on
  a site with no checkout misleads customers and reviewers alike.
- `WhyHeartfolio` carried a review attributed to "Adrian, Star Map
  customer". The product has not launched, so that quote describes a
  purchase nobody has made. Removed, replaced with a brand statement in
  Heartfolio's own voice.

---

## 2. Built

**Product pages** — `/[locale]/products/[slug]`: hero, story, how it works,
available versions with prices, what's included, per-product FAQ, one CTA.
No radio buttons, dropdowns, quantity pickers or configuration anywhere
(§13). `/products` collection index added.

**Offerings data model** — `offerings[]` on each product with
`type / price / currency / detailsKey / available / media`, shaped like the
API response that will eventually replace it. Only offerings that exist for
a product render: Heart Map has two, Star Map has four (§11). Starting
prices are derived from the offerings, never hardcoded, so a card and a
product page cannot disagree.

**Prices** — USD only, formatted `$12 USD`. No conversions anywhere.

**Legal & support** — Privacy, Terms, Refunds and Contact pages, fully
translated in all three languages, linked from the footer, indexable, and
written to be compatible with a merchant-of-record setup.

**Structured data** — Organization + WebSite on the homepage, CollectionPage
+ ItemList on `/products`, Product + Offer + BreadcrumbList + FAQPage on
each product page. Every claim is visible on the page. No ratings, reviews
or availability we cannot support.

**Sitemap** — every route x every locale with `xhtml:link` alternates.
Previously three homepage URLs on the wrong domain.

**Hero** — was one floating framed star map, which read as "Heartfolio is a
star map generator". Now a composition: one dominant piece with two
keepsakes behind it as glimpses, deliberately unequal, plus a compact strip
on small screens where the composition is hidden.

**RTL (§24)** — directional utilities converted to logical properties
(`start-*` / `end-*` / `ps-*` / `pe-*` / `text-start`); arrows mirror via
Tailwind's `rtl:` variant rather than JS locale checks; Latin letter-spacing
is suppressed for Arabic, where it severs the joins; Arabic headings get
their own line-height.

---

## 3. Decisions you need to make

1. **Support email.** No contact address exists anywhere in the codebase,
   and the brief says not to invent one. `SUPPORT_EMAIL` in
   `src/lib/site-config.ts` is a placeholder derived from the domain, marked
   with a TODO. Paddle will email that address — confirm or replace it.
2. **Prices are the brief's structure, not a commercial decision.**
   12 / 8 / 18 / 30 USD, flagged as provisional in `registry.ts`. Sign them
   off and match them to the Paddle catalogue.
3. **Refund window.** The policy commits to fixing or refunding anything
   broken, and states that personalized instant downloads are not
   automatically refundable on a change of mind — but it does **not** invent
   a number of days, because that is your call and it has to match what you
   will actually honour.
4. **Product naming.** The brief lists Moon Phase and Where We Met; the code
   has Star Map and Heart Map. I kept the code as the source of truth rather
   than silently renaming live products. Say the word and it is a registry +
   messages change.

---

## 4. Known limitations

- **Arabic OG cards fall back to English.** The renderer behind `next/og`
  (satori) does not shape Arabic or reorder bidirectional text. I generated
  one and looked at it: the letters come out in isolated forms in the wrong
  order — unreadable, not merely imperfect. So `/ar` pages share the English
  card for the same product: right brand, right product, right price, Latin
  script. Fixing it properly needs a real text engine (headless browser
  screenshot, or Resvg with pre-shaped SVG). Documented at the top of
  `src/lib/og.tsx`.
- **Product artwork is still generated SVG.** Deliberate, and far better
  than stock — but the framed-interior, phone-mockup and complete-pack
  presentations the brief describes are documented as specific asset TODOs
  at the bottom of `registry.ts` and in `offering-visual.tsx`, not quietly
  filled with stock photography.
- **Responsive behaviour is reasoned, not measured.** Layouts use the
  existing breakpoint system and were checked by reading, but I had no
  browser here — the hero composition on tablet and the offering panels in
  Arabic are the two places worth looking at first on a real device.
- **The brief was truncated mid-§34** ("Optimize image"). Anything from
  there on has not been addressed.
