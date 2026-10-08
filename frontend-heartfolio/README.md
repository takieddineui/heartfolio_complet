# Heartfolio — Landing Page

A production-readys marketing homepage for Heartfolio, built to the brand's own
brief: *"Not a design tool. A place where memories become heirlooms."*

##   S tack  

- **Next.js 16** (App Router, React Server Components)
- **TypeScript** (strict mode)
- **Tailwind CSS v4** (CSS-first `@theme` tokens — no `tailwind.config.js`)
- **shadcn/ui**-style primitives (`Button`, `Accordion`) built on Radix + CVA
- **Framer Motion** for scroll reveals and the signature star-field animation
- **Lucide React** for the thin-line icon set
- **next-intl** for locale routing (`en` / `fr` / `ar`, geo + Accept-Language
  aware — see below)

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. First-time visitors are redirected to `/fr` or
kept at the un-prefixed English default depending on where they're
connecting from (see **Locale detection** below); `/ar` is only ever reached
by explicitly choosing it in the language switcher. The site opens in **dark
mode** by default — the toggle in the header switches to light and
remembers the choice.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build        # production build
```

## Project structure

```
src/
  app/
    [locale]/
      layout.tsx        # HTML shell, metadata, NextIntlClientProvider
      page.tsx           # Section composition + JSON-LD
      not-found.tsx       # Brand-voice 404
    globals.css           # Tailwind v4 @theme tokens (color, type, spacing, motion)
    robots.ts / sitemap.ts / manifest.ts
  components/
    layout/               # Header (nav + theme/locale toggles) + Footer (editorial, quiet)
    sections/              # One file per homepage section
    ui/                    # Button, Accordion (shadcn-style primitives)
    motion/                 # Reveal (scroll fade+drift), StarField (signature moment)
    theme/                  # ThemeProvider + ThemeToggle (light/dark, no-flash script)
    illustrations/          # Fine-line SVG marks (constellation, botanical, moon, pin)
  i18n/                    # next-intl routing, navigation, request config
  messages/               # en.json / fr.json / ar.json — all homepage copy
  proxy.ts                 # geo + Accept-Language locale detection (Next.js 16 "proxy" convention)
```

## Design decisions worth knowing

- **Digital-only product.** Heartfolio sells a $12 digital download (high-res
  PNG + print-ready PDF) — there is no physical printing, framing, or
  shipping. Every section was rewritten to reflect that honestly: no "hang on
  a wall" / "we frame it" language remains. Buyers print it themselves,
  frame it themselves, or use it as a phone wallpaper — that's stated
  plainly near the price and in the FAQ, on purpose, rather than buried in
  fine print.
- **Only the 3 products live in the studio are featured**: Star Map, Song
  Poster, and Heart Map. The other product concepts from the original brief
  (Birth Poster, Memorial Print, Timeline Poster) were removed from
  `FeaturedKeepsakes` — not deleted from the brand, just not shown until the
  studio actually supports them. Add them back to `ORDER` in
  `featured-keepsakes.tsx` (plus matching entries in `en.json` / `fr.json`)
  once they exist.
- **Dark mode is the default.** The site opens dark unless a visitor has
  explicitly switched to light before (persisted via `localStorage`). A
  blocking inline script (`NO_FLASH_SCRIPT` in `theme-provider.tsx`) sets
  the class before paint, so there's no flash of the wrong theme on load.
  Only five semantic tokens (`--color-page`, `--color-card`,
  `--color-heading`, `--color-body`, `--color-subtle`) flip between
  light/dark — the intentionally-always-dark "night" sections (Hero,
  Footer, Gift Occasions, Final CTA, the pricing card) keep using the raw
  `ink-navy` / `parchment` tokens directly and are unaffected by the
  toggle, since they represent a fixed candlelit surface by design.
- **Locale detection is browser-based, never geo-IP.** (Rewritten — see
  CHANGES.md.) `proxy.ts` reads the q-weighted `Accept-Language` header:
  `ar-*` → `/ar`, `fr-*` → `/fr`, everything else → `/en`. Country is
  ignored entirely. The resolved locale is written to `NEXT_LOCALE` so
  detection runs once; choosing a language in the switcher overwrites that
  cookie and is never second-guessed afterwards. All three locales are
  URL-prefixed (`localePrefix: "always"`).

- **Superseded note, kept for history — the old geo behaviour:** `proxy.ts`
  disables `next-intl`'s built-in detection (`localeDetection: false` in
  `routing.ts`) and implements its own: on a visitor's first request, it
  checks `x-vercel-ip-country` (falling back to the browser's
  `Accept-Language` primary subtag when no geo header is available, e.g.
  local dev or non-Vercel hosts) against a list of English-speaking
  countries. English-speaking → `en` (the un-prefixed site default);
  everywhere else → `fr`. The choice is written to a `NEXT_LOCALE` cookie
  so it only happens once. **Arabic is never auto-detected** — the
  guessing function can only return `en`/`fr`; `ar` is reachable solely by
  explicitly clicking it in the header's language switcher (or via a
  returning visitor's saved cookie/URL). Arabic pages render with
  `dir="rtl"` on `<html>`, though note the layout itself hasn't been
  audited for full RTL mirroring (flex/grid direction, icon placement) —
  text renders correctly, but a proper RTL pass would still be worthwhile
  before this ships to Arabic-speaking users.
- **The signature "stars → moon → hearts" sequence**
  (`components/motion/celestial-sequence.tsx`) plays in the Hero and, in a
  quieter variant, in the Final CTA: stars shine in and settle into a
  continuous twinkle, a small crescent moon rises and glows softly, then a
  few hearts drift upward and fade — looping gently forever after the first
  pass. It's one deterministic SVG (seeded PRNG) so server and client
  markup always match exactly.
- **No stock photography.** Every visual moment (the star map, the
  soundwave, the heart-shaped map mark) is a bespoke, deterministic SVG,
  animated with Framer Motion — continuously twinkling stars, a beating
  heart on the Heart Map card, a live soundwave on hover — so it renders
  identically on server and client with zero layout shift.
- **Motion follows the brand's animation philosophy**: one custom easing
  curve (`cubic-bezier(0.22, 1, 0.36, 1)`), 300–500ms for UI, and longer
  choreographed reveals for the moments that deserve them (hero star field,
  the floating framed-keepsake mockup). No bounce, no confetti, no spinners.
- **Color tokens are named, not utility-first defaults** — `ink-navy`,
  `champagne-gold`, `parchment`, `soft-charcoal`, etc. — defined once in
  `globals.css` under Tailwind v4's `@theme`, so `bg-ink-navy` /
  `text-champagne-gold` are generated automatically with no separate config
  file.
- **Copy follows the brand voice guide** line by line: second person, no
  startup language, short sentences, occasion-specific tone (the memorial
  copy is deliberately quieter and shorter than the anniversary copy).
- **Accessibility floor**: visible focus rings on every interactive element,
  `prefers-reduced-motion` respected globally, labelled form fields, semantic
  landmarks, skip-to-content link, and a single `<h1>` per page.

## Known placeholder: "Start Creating" buttons (partly resolved)

`/create` and `/products` both exist now; the hero points at the collection
and product pages carry a single "Create yours" CTA whose destination comes
from the registry's `status`. What is still a placeholder is the Studio
route itself (`/studio/:slug`), which does not exist yet.

### Original note

Every CTA currently scrolls to the on-page Gift Occasions section
(`/#occasions`) — this is intentional, not a bug. There is no `/create`
route yet. Once the creation studio is integrated, repoint these links
(Hero, header nav, mobile sticky CTA, Gift Occasions cards, Final CTA) to
the real studio route.

## Adding real photography later

`KeepsakeVisual` (in `featured-keepsakes.tsx`) and the mood previews in
`template-gallery.tsx` are the two places to swap SVG placeholders for real,
art-directed photography once it exists — replace the inline SVG with
`next/image` and the same aspect-ratio wrapper will hold.
