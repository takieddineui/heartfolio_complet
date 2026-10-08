# Heartfolio Design System

This documents everything visual and structural in the Marketing App so the
Studio App (built later, as its own project) can share the same look and
feel without re-deriving it. Everything here already exists in
`globals.css` and the component primitives — this file is the reference,
not a redesign.

---

## 1. Brand Colors

Defined once, under Tailwind v4's `@theme` in `src/app/globals.css`. These
generate `bg-*` / `text-*` / `border-*` utilities automatically — there is
no separate Tailwind config file.

| Token | Value | Use |
|---|---|---|
| `--color-ink-navy` | `#141b2e` | Primary dark surface (hero, footer, "always night" sections) |
| `--color-navy-deep` | `#1d2540` | Secondary dark surface / gradients |
| `--color-parchment` | `#f7f1e6` | Primary light surface / text-on-dark |
| `--color-candle-white` | `#fffdf8` | Card surface (light mode) |
| `--color-champagne-gold` | `#c9a24b` | Primary accent — links, active states, CTAs |
| `--color-champagne-gold-bright` | `#d9b968` | Accent hover state |
| `--color-dusty-terracotta` | `#b5654b` | Secondary accent (warm) |
| `--color-muted-sage` | `#6b7a5e` | Secondary accent (cool/success-adjacent) |
| `--color-soft-charcoal` | `#3a3a38` | Primary body text (light mode) |
| `--color-warm-fog` | `#dcd4c4` | Borders/dividers (light mode) |
| `--color-error-warm` | `#a24a34` | Error/validation text |

There is no separate "success"/"warning" token today — `muted-sage` and
`error-warm` are used for those roles respectively. Add dedicated tokens
under `@theme` if the Studio app needs a formal 3-state system.

### Semantic tokens (the only ones that flip between light/dark)

| Token | Light | Dark |
|---|---|---|
| `--color-page` | `parchment` | `#0f1220` |
| `--color-card` | `candle-white` | `#171b2c` |
| `--color-heading` | `ink-navy` | `#f7f1e6` |
| `--color-body` | `soft-charcoal` | `#cfc9ba` |
| `--color-subtle` (borders) | `warm-fog` | `#2c3248` |

Sections that are intentionally "always night" regardless of theme (Hero,
Footer, Gift Occasions, Final CTA, Waitlist) use the raw `ink-navy`/
`parchment` tokens directly, not the semantic ones — this is a deliberate
design decision (a fixed candlelit surface), not a bug.

---

## 2. Typography

```
--font-serif: "Fraunces", "Canela", "GT Sectra", Georgia, serif;
--font-sans: "Inter", "Söhne", "Neue Montreal", -apple-system, sans-serif;
--font-mono: "JetBrains Mono", "GT America Mono", ui-monospace, monospace;
```

- **Headings** (`h1`–`h3`, `.font-serif-display`) always use `--font-serif`,
  with `letter-spacing: -0.01em`.
- **Body copy** uses the sans stack by default (set on `<body>`).
- **Scale in practice** (not a formal type-scale token set — sizes are
  applied ad hoc per component via Tailwind's default scale plus a few
  custom values): hero headline `text-[40px]` → `sm:text-6xl` →
  `md:text-7xl`; section headings `text-3xl` → `sm:text-4xl` →
  `md:text-5xl`; body `text-base`/`text-[15px]`; eyebrows/labels
  `text-xs uppercase tracking-[0.18em]`.
- **Line height / weight**: no custom scale beyond Tailwind defaults;
  headings don't set an explicit `font-weight` (relies on the serif font's
  own weight), body text is default (400).

---

## 3. Spacing & Radius

```
--radius-sm: 6px;
--radius-md: 12px;
--radius-lg: 20px;
--radius-xl: 32px;
--radius-full: 999px;

--spacing-18: 4.5rem;   /* extends Tailwind's default scale */
--spacing-30: 7.5rem;
--spacing-35: 8.75rem;
```

No custom margin/padding scale beyond Tailwind's default `0.25rem` grid —
`--spacing-18/30/35` are the only additions, used for large section
vertical rhythm (`py-24 sm:py-30`, header height `h-18`).

---

## 4. Shadows & Motion

```
--shadow-whisper: 0px 1px 2px rgba(20, 27, 46, 0.04);
--shadow-lift:    0px 8px 24px rgba(20, 27, 46, 0.08);
--shadow-float:   0px 24px 60px rgba(20, 27, 46, 0.14);
--shadow-candle:  0px 0px 60px rgba(201, 162, 75, 0.22);

--ease-heartfolio: cubic-bezier(0.22, 1, 0.36, 1);
```

**Motion principles:**
- One easing curve everywhere (`--ease-heartfolio`) — no bounce, no
  spring, no confetti.
- UI transitions: 300–500ms.
- Content reveals: 700–900ms, via the shared `<Reveal>` /
  `<RevealGroup>` / `<RevealItem>` components (`src/components/motion/
  reveal.tsx`) — fade + 16px upward drift, triggered on scroll into view,
  staggered 80–120ms apart for groups.
- Named keyframe animations (all under `@theme`, so Tailwind v4
  auto-generates matching `animate-*` utility classes):
  `drift-in`, `star-fade`, `twinkle`, `shimmer`, `float-slow`,
  `accordion-down`/`accordion-up`.
- `prefers-reduced-motion: reduce` is respected globally (see
  `globals.css` `@layer base`) — all animation/transition durations
  collapse to near-zero automatically.

---

## 5. Components

### Button (`src/components/ui/button.tsx`)
CVA-based, 4 variants × 3 sizes:
- **Variants**: `primary` (navy bg / gold text), `secondary` (outlined),
  `ghost` (underlined text link), `onDark` (gold bg / navy text — used on
  dark sections).
- **Sizes**: `default` (h-13), `lg` (h-14), `sm` (h-10).
- Supports `asChild` (Radix `Slot`) to render as a `<Link>` while keeping
  button styling.

### Accordion (`src/components/ui/accordion.tsx`)
Thin wrapper over `@radix-ui/react-accordion`. `type="single" collapsible`
is the pattern used everywhere one-section-open-at-a-time is wanted (FAQ,
and previously the Studio sidebar).

### Cards
No single generic `<Card>` primitive exists yet — each section
(`ProductCard`, FAQ items, pricing card, etc.) implements its own card
markup following the same conventions: `rounded-[var(--radius-lg)]`,
`shadow-[var(--shadow-whisper)]` at rest → `shadow-[var(--shadow-lift)]`
on hover, `border-subtle`. If the Studio app needs many more card types,
extracting a shared `<Card>` primitive following these conventions is a
reasonable next step.

### Inputs
No shared `<Input>` component — every text/date/time/email input in the
codebase uses the same inline Tailwind recipe:
```
h-13 w-full rounded-[var(--radius-md)] border border-subtle bg-card
px-4 text-[15px] text-body placeholder:text-body/40
focus:border-champagne-gold focus:outline-none
```

### Badges/Chips
Small pill labels (e.g. product badges, "Waitlist" tags) follow:
```
rounded-full bg-candle-white/90 px-3 py-1 text-[11px] font-medium
tracking-wide text-ink-navy
```
No dedicated `<Badge>` component yet — same recommendation as Cards above.

### Dropdowns / Modals
Not yet used anywhere in the Marketing App. `@radix-ui/react-dialog` is
installed as a dependency but has no current implementation — available
for the Studio app to use directly, following the same visual language
(rounded-lg, shadow-float, ink-navy/parchment surfaces).

---

## 6. Icons

- **Library**: `lucide-react` exclusively.
- **Stroke width**: `1.5` for chrome/toolbar icons, `1.75` for
  emphasis/CTA icons (e.g. inside buttons), `2` for small inline icons
  (badges, checkmarks). No single fixed default — chosen per context for
  visual weight.
- **Sizes**: mostly `h-4 w-4` (16px) inline, `h-3.5 w-3.5` (14px) in small
  badges/pills, `h-9 w-9` (36px) for large illustrative icons on cards.

---

## 7. Themes (Light/Dark)

- **Mechanism**: a `.dark` class toggled on `<html>`, via
  `ThemeProvider`/`useTheme()` (`src/components/theme/theme-provider.tsx`).
  State lives in React context; persisted to `localStorage` under the key
  `heartfolio-theme`.
- **No-flash script**: `NO_FLASH_SCRIPT` is injected as a blocking
  `<Script strategy="beforeInteractive">` in the root layout — it reads
  `localStorage` and adds `.dark` to `<html>` before paint. Dark is the
  site default until a person explicitly switches.
- **Consumption**: components read only the 5 semantic tokens (section 1)
  via Tailwind classes (`bg-page`, `text-heading`, etc.) — never
  hardcoded hex values for anything that should theme-switch.
- **Reuse in the Studio app**: copy `theme-provider.tsx` and the
  no-flash script verbatim; both are self-contained with no dependency on
  Marketing-App-specific state.

---

## 8. Responsive Breakpoints

Tailwind v4 defaults, used throughout — no custom breakpoints defined:
`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px. Mobile-first
throughout (unprefixed = mobile, `sm:`/`md:`/`lg:` layer up).

---

## 9. Localization

- **Library**: `next-intl`, App Router integration via
  `src/i18n/{routing,navigation,request}.ts`.
- **Locales**: `en` (default, unprefixed URLs), `fr`, `ar`.
- **Translation files**: `src/messages/{en,fr,ar}.json` — one flat file
  per locale, namespaced by section (`Hero`, `FeaturedKeepsakes`, `Faq`,
  etc.). No per-component translation files.
- **Language switching**: `LocaleSwitcher` component +
  `router.replace(pathname, { locale })` from `next-intl`'s navigation
  helpers.
- **RTL/LTR**: `dir={locale === "ar" ? "rtl" : "ltr"}` set on `<html>` in
  the root layout — the *entire* page mirrors automatically via native
  CSS logical properties/browser behavior. No per-component RTL logic
  needed; this is why the Studio's sidebar automatically appeared on the
  correct side in Arabic with zero extra code.
- **Locale detection**: custom `proxy.ts` middleware — the browser's
  `Accept-Language` alone picks `ar`/`fr`/`en` on the first visit; country is
  ignored (the old `x-vercel-ip-country` geo-header detection was removed — see
  the comment in `proxy.ts`). The choice persists via a `NEXT_LOCALE` cookie.
- **Date/number formatting**: no custom formatting utilities exist today
  — dates are stored/displayed as plain ISO strings
  (`new Date().toISOString().slice(0, 10)`) or via native
  `toLocaleDateString`/`Intl` where used ad hoc (e.g. footer copyright
  year). If the Studio app needs locale-aware date/number formatting,
  `next-intl`'s built-in `useFormatter()` is the natural fit — not yet
  wired up anywhere in this codebase.

**Important scoping note:** the Product Registry (`src/lib/products/
registry.ts`) currently stores product name/description in plain English
strings only — it is **not yet localized**. Same for the new Create and
Waitlist page chrome text. Localizing product content is a real follow-up
task, not done as part of this refactor; see the Studio Integration Guide
for how the registry should evolve to carry per-locale strings.

---

## 10. What's shared vs. what's Marketing-App-only

**Safe to copy into the Studio app as-is** (zero Marketing-specific
dependencies):
- `globals.css` (all tokens)
- `src/components/ui/*` (Button, Accordion)
- `src/components/motion/*` (Reveal, StarField, CelestialSequence)
- `src/components/theme/*` (ThemeProvider, ThemeToggle, no-flash script)
- `src/lib/utils.ts` (`cn()` helper)

**Shared by reference, not by copy** (see the Studio Integration Guide for
the recommended mechanism):
- `src/lib/products/registry.ts` — this should become a shared package or
  a shared API, not two independent copies that can drift.
- i18n message structure/conventions (the *pattern*, not the literal
  `messages/*.json` files, which are Marketing-App content).
