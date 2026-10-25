# Heartfolio — Change Map for the Next Pass

Inspection only. **No files modified.** Everything below is a `file:line`
or message-key reference against the current implementation, checked
against the Source of Truth document.

Your document was truncated mid-§41 ("Map the existing routes, components,
product data, CTA destinations, SEO data, structu…"), so §41 onward is not
reflected here.

---

## 0. BLOCKERS — six decisions needed before any code changes

These are business/content decisions I must not make for you (§29).

**B1. Four of the eight products don't exist in code.**
Registry holds 4: `star-map`, `song-poster`, `heart-map`, `love-story-timeline`.
Missing: **Moon Phase, Birth Poster, Wedding Keepsake, Pet Memorial**.
Adding them needs, per product: display name ×3 locales, short + full
description, story, meta title/description, 3 FAQ entries, offering list,
provisional prices, an icon, and bespoke artwork. I cannot invent these
(§33, §39). Options: (a) you supply the content and I add all four;
(b) I add them as `coming_soon` stubs with content you write later;
(c) they stay out until Studio supports them.

**B2. §5 asks for a Birth Poster glimpse in the hero — Birth Poster
doesn't exist.** Dominant = Love Story Timeline ✅ exists. Glimpse 1 =
Where We Met ✅ exists. Glimpse 2 = Birth Poster ❌. Either resolve B1
first, or substitute Song Poster for this pass.

**B3. Where does a product CTA go while a product is on the waitlist?**
§16/§17 say product CTA → `/create?product=<slug>`. But all four products
are currently `status: "waitlist"` or `"coming_soon"`, and today their CTA
goes to `/waitlist?product=`. Which wins — always `/create?product=`, or
`/create` only once `status === "available"`?

**B4. Does the Digital offering keep its file-spec line?**
§9 says Digital = the native digital/web experience, not PNG/PDF.
§30 says leave 300 DPI / PNG / PDF unchanged and verify later. These
collide on exactly one string: `Products.offeringDetails.digitalFiles` =
"High-resolution PNG · instant download". Keep, drop, or replace with a
non-file line?

**B5. Is the celestial visual system the brand, or Star Map's?**
§6 says celestial is not Heartfolio's identity. But the *entire* design
system is celestial: `--color-ink-navy` as the primary dark, `StarField`
and `CelestialSequence` in the hero and final CTA, `ConstellationMark` in
the footer, "Midnight" as a mood name. Debiasing the *copy* is a contained
change. Debiasing the *visual system* is a rebrand and would contradict
§39 ("do not rebuild from scratch"). Which scope do you want?

**B6. Slug migration strategy for Where We Met.** My recommendation is
below in §1 — needs a yes/no because it affects the Supabase waitlist data.

---

## 1. PRODUCT NAMING (§2) — P0

### 1a. `heart-map` → Where We Met

**Recommended approach: change the slug, keep the id.**

| Field | Now | Proposed | Why |
|---|---|---|---|
| `id` | `"heart-map"` | **unchanged** | It's the key written to Supabase `waitlist_entries.product_id`. Keeping it means **zero data migration** |
| `slug` | `"heart-map"` | `"where-we-met"` | The public URL |
| `i18nKey` | `"heartMap"` | `"whereWeMet"` | Message namespace |
| — | — | `previousSlugs: ["heart-map"]` | New field, drives 301s |

**Files affected:**

- `src/lib/products/registry.ts:74-82` — the entry itself.
- `src/lib/products/types.ts` — add `previousSlugs?: string[]`.
- `next.config.ts` — add 301 redirects `/:locale/products/heart-map` →
  `/:locale/products/where-we-met`, generated from `previousSlugs`.
- `src/messages/{en,fr,ar}.json` — rename `Products.heartMap` →
  `Products.whereWeMet` and change the display name in all three:
  - EN "Heart Map" → **"Where We Met"**
  - FR "Carte du cœur" → **needs your approval** (suggest "Là où nous nous
    sommes rencontrés" — long; or keep "Where We Met" untranslated as a
    product name, which many premium brands do)
  - AR "خريطة القلب" → **needs your approval** (suggest "حيث التقينا")
- **Body copy that names the old product**, all three locales:
  `whereWeMet.story` currently opens "A **Heart Map** takes the exact
  spot…"; `whereWeMet.faq[1]` cross-references the Love Story Timeline.
- `src/components/product/keepsake-visual.tsx:95` — keyed on
  `productId === "heart-map"`. **No change needed** if the id stays; this
  is a second argument for the id/slug split.
- `src/components/sections/hero.tsx:62,164` — hardcoded id strings.
- `STUDIO_INTEGRATION_GUIDE.md` — example hand-off URLs.

**If you'd rather change the id too:** add a Supabase migration
(`update waitlist_entries set product_id='where-we-met' where
product_id='heart-map'`) and update `keepsake-visual.tsx`. Doable, just
strictly more work for no gain.

### 1b. Star Map stays; Moon Phase is a separate product

No change to `star-map`. Moon Phase is **not** in the registry — see B1.
Nothing in the current code merges or confuses them, so there is no bug to
fix here, only a gap.

### 1c. Love Story Timeline / Timeline Poster

Already a single product (`love-story-timeline`). The string "Timeline
Poster" appears **nowhere** in the codebase. **No change required.**

---

## 2. `/create` GATEWAY AND CTA DESTINATIONS (§16, §17) — P0

**Good news:** `/create` already does most of what §16 describes.
`src/app/[locale]/create/page.tsx:14` reads `?product=` and preselects it,
and the user can still change the selection. That mechanism is correct and
should be kept.

**The problem: one function is serving two different jobs.**
`getCreateDestination()` (`registry.ts:~130`) currently returns
`/studio/:slug` | `/waitlist?product=` | unavailable — and it is used both
for *marketing CTAs* (which should enter `/create`) and for the *Continue
button on `/create` itself* (which should exit toward Studio). These need
to be two functions:

- `getCreateEntry(product)` → `/create?product=<slug>` — for every
  marketing CTA.
- `getStudioDestination(product)` → Studio / waitlist / unavailable — for
  the Continue button only. (Subject to **B3**.)

**Every CTA destination, current vs required:**

| File:line | Now | Required |
|---|---|---|
| `header.tsx:56,112` | `/create` | ✅ correct (global CTA) — label change only |
| `hero.tsx:131` | `/products` | Decision: keep as "Explore the collection", or make it the global `/create` CTA |
| `pricing.tsx:74` | `/create` | ✅ correct |
| `final-cta.tsx:41` | `/create` | ✅ correct |
| `gift-occasions.tsx:75` | `/create` (all 5 cards) | §25: filtered collection. Interim `/products?occasion=<key>` |
| `product-view.tsx` CTA | `/studio/:slug` or `/waitlist?product=` | **`/create?product=<slug>`** (per B3) |
| `product-collection.tsx` card | `/products/<slug>` | ✅ correct (presentation first) |
| `product-card.tsx:113` Continue | Studio/waitlist | ✅ correct — this is the exit, keep |

**Label changes** (`src/messages/{en,fr,ar}.json`):
- `Nav.cta` "Start Creating" → **"Create a keepsake"** (§16 global CTA)
- `ProductPage.createYours` "Create yours" → **"Create your keepsake"** (§17)
- `FinalCta.cta`, `Pricing.single.cta` "Start Creating" → align with §16
- `Create.startCreating` — this is the *Studio* hand-off, so it can stay

---

## 3. HOMEPAGE PRICING CONTRADICTION (§15) — P0

`src/components/sections/pricing.tsx` + `Pricing` in all three locales.

| Key | Now | Required |
|---|---|---|
| `Pricing.title` | "One honest price.\nNo surprises at checkout." | "Simple, transparent pricing." |
| `Pricing.single.price` | hardcoded `"$12"` | **Derived** — `Math.min` of `getStartingPrice()` across the registry, rendered `From $12 USD` |
| `Pricing.subtitle` | "The price you see is the price you pay…" | Add "Each keepsake has its own available formats and pricing" |
| `Pricing.single.features[4]` | "Adjust the date, the words, the sky — as many times as you like before you buy" | KEEP the mechanic (§19/§30 approved), remove "the sky" (§6) |
| `Pricing.single.features[5]` | "Redownload anytime, no expiry" | **REMOVE** (§21) |
| `Pricing.single.reassurance` | "Secure checkout. Delivered to your inbox instantly." | Rewrite to §20's safe claim |

The single fixed-price card also needs restructuring so it no longer reads
as one universal price, plus a link to `/products` for per-product pricing.

---

## 4. CLAIM AUDIT (§29, §30) — P0

Classified per your four categories. **Nothing changes without your
sign-off on this table.**

### REMOVE — account & permanence (§21, §22)

| Location | Text |
|---|---|
| `Faq.items.lost.answer` | "Your keepsake lives in **your account** for good, ready to redownload whenever…" |
| `Faq.items.reorder.answer` | "your design lives in **your account** exactly as you made it, ready to reorder…" |
| `WhyHeartfolio.pillars.instant` | "…and yours to redownload, **always**" |
| `WhyHeartfolio.comparison.us.points[3]` | "Yours to redownload, **forever**" |
| `Pricing.single.features[5]` | "Redownload anytime, no expiry" |
| `ProductPage.included.items[5]` | "Access to redownload your files whenever you need them" |
| `FinalCta.trust` | "Delivered instantly. Yours to keep **forever**." |
| `Nav.secondary.track` / `.account` | "Track My Order" / "Account" — **dead keys**, no longer rendered by the header, but still in all three message files implying an account system |

Note: `Faq.lost` and `Faq.reorder` are *entire FAQ entries* built on
accounts. They likely need deleting rather than rewording — which means
the FAQ section loses two items.

### REWRITE

| Location | Text | Why |
|---|---|---|
| `Faq.items.preview.answer` | "a true render of your **paper, frame, and colors**, not a mockup" | Contradicts digital-first (§9, §10) |
| `ProductPage.included.items[4]` | "Unlimited changes to your details before you download" | Align to §19's approved wording ("before you buy") |
| `Hero.subhead` | "delivered as a **digital file you can print, frame** or set as your wallpaper" | Printable-forward (§10); Digital ≠ file (§9) |
| `Hero.trust` | "Digital keepsakes. Delivered instantly. **Yours to keep**." | Softer permanence implication (§21) |
| `Legal.contact.sections[3]` | "We answer every request" | Absolute, unqualified |
| `GiftOccasions.items.newBaby.cta` | "Create a birth keepsake" | Birth Poster doesn't exist (resolves if B1 = add) |
| `GiftOccasions.items.inMemory.cta` | "Create a memorial print" | Pet Memorial doesn't exist; also "print" over-emphasises Printable (§10) |

### KEEP (explicitly approved in §30)

`Hero.headline` "Some moments deserve more than a photo" ·
`WhyHeartfolio.title` "We're not a design tool. We're a craftsman." ·
the customize-before-buy mechanic · download-after-purchase.

### VERIFY LATER (§29, §30 — leave unchanged, flag for Studio check)

300 DPI · print-ready PDF · high-resolution PNG · "up to 24″ × 36″"
(`Faq.sizing`) · "instant download" (×6 locations) · Star Map "calculated
from real astronomical data" · Song Poster "the actual waveform of the
track you choose" and **"no audio is sold, included or distributed"**
(a legal statement) · Where We Met "real street geometry… rather than a
screenshot" (there's a Mapbox token in `.env.local` — check their terms on
redistribution) · Love Story Timeline "up to five milestones" ·
"Every mood is art-directed by hand" · the four named moods (Midnight,
Warm Ivory, Vintage Chart, Golden Hour) · `HowItWorks.two` "rendered
slowly in front of you".

**⚠️ Several of these sit inside `FAQPage` structured data on product
pages** — machine-readable assertions, so they carry more weight than copy.

---

## 5. DIGITAL TERMINOLOGY (§9, §13) — P0, and the one real architectural change

**The problem:** offering copy is currently **global**, not per-product.
`Products.offerings.digital.description` is a single string shared by every
product: *"Your finished artwork in high resolution — to keep on a screen,
share, or print yourself."* §9 requires Digital to mean something
product-specific (a digital map experience vs a digital timeline
experience). The current data model cannot express that.

**Required change:** per-product offering overrides with fallback to the
global string. Roughly:

```
Products.<product>.offerings.<type>.description   ← optional override
Products.offerings.<type>.description             ← fallback
```

Affects `src/components/product/product-view.tsx` (the `tOffer` lookup at
the offerings section) and all three message files. Contained, but it is
the one genuine structural change this pass needs.

**Copy that currently frames everything as downloadable files** (§9, §10):

| Location | Issue |
|---|---|
| `Products.offerings.digital.description` | "finished artwork… print yourself" — file-framed and printable-forward |
| `Products.offeringDetails.digitalFiles` | "High-resolution PNG · instant download" — **see B4** |
| `ProductPage.digitalNotice` | "you receive **files** to download, print or keep on your phone" |
| `ProductPage.included.items[1..2]` | leads with PNG and PDF |
| `FeaturedKeepsakes.digitalNote` | "Every keepsake is a digital download — print it, frame it…" |
| `Collection.digitalNote` | "PNG… print-ready PDF… printing and framing are yours to arrange" |
| `Footer.digitalNotice` | "Every keepsake is a downloadable **file**" |

**Constraint:** the "no physical item, nothing is shipped, printing and
framing not included" statements must **survive** the rewrite — Paddle
needs them (§28). The change is one of emphasis: lead with the keepsake
and the digital experience, keep the shipping disclaimer as a factual
footnote rather than the headline.

**Complete Pack (§11):** `Products.offerings.complete_pack.description`
currently hardcodes "screen, print and phone" — wrong for a product whose
pack is Digital + AR + VR. Needs to become generic, or ideally
data-driven via an `includes: OfferingType[]` field so the UI can list the
actual contents.

---

## 6. COLLECTION SECTION (§3, §4) — P1

- `FeaturedKeepsakes.title` "Four ways to keep\nthe same feeling." →
  **"A keepsake for every kind of moment."** (×3 locales)
- `FeaturedKeepsakes.cta` "View the full collection" → "Explore all
  keepsakes" (§3)
- **The ~4-featured mechanism already exists** —
  `getFeaturedProducts()` filters on `featured: true`, and all four
  current products carry it. Once more products exist, that flag is the
  curation control. §3 satisfied by construction; nothing to build.
- Today "Explore all keepsakes" leads to `/products`, which shows the
  **same four** — the promise of "more" isn't met until B1 is resolved.
- `FeaturedKeepsakes.subtitle` "a date, a place, a song, a story" implies
  exactly four products; worth generalising.

---

## 7. HERO (§5, §7) — P1

`src/components/sections/hero.tsx`:

- Line 84 — dominant piece `productId="star-map"` → **`love-story-timeline`**
- Line 62 — glimpse `"heart-map"` → **`where-we-met`** (id-dependent, see 1a)
- Second glimpse currently `"song-poster"` (line ~72) → **Birth Poster**, blocked on B2
- Line 164 — mobile strip array order should follow the same priority
- **Add the plain-language definition (§7)** as visible copy under the
  headline: *"Beautiful personalized digital keepsakes for the moments
  worth remembering."* New message key, ×3 locales. This is also the fix
  for the §34 AI-discoverability gap — the homepage currently never states
  what Heartfolio is outside `<meta>` and JSON-LD.
- Background is `CelestialSequence` + `StarField` — **blocked on B5**.

---

## 8. CELESTIAL COPY DEBIAS (§6) — P1

Copy-level only (visual system is B5):

| Location | Text |
|---|---|
| `HowItWorks.steps.two.description` | "Your **sky**, your street, your story" |
| `Pricing.single.features[4]` | "the date, the words, **the sky**" |
| `Faq.items.incomplete.answer` | "An approximate time still renders a beautiful, accurate **sky**" — this is a Star Map answer presented as a brand answer |
| `TemplateGallery.items.midnight` | "Deep navy **skies**, fine gold linework" |
| `TemplateGallery.items.vintageChart` | "Antique **astronomy-chart** linework" |
| `Faq` generally | Several entries are Star Map questions in brand position |

Homepage FAQ is the biggest offender — it reads as one product's FAQ.

---

## 9. SUPPORT EMAIL (§26) — P0

`src/lib/site-config.ts:22` → `support@theheartfolio.com`. Single constant;
propagates to the footer, all four legal pages (`{email}` token, 9 spots
× 3 locales) and `Organization.email` + `contactPoint.email` JSON-LD on the
homepage. Remove the TODO comment.

---

## 10. REFUND POLICY (§27) — no change

Verified: no refund period is stated anywhere. `Legal.refunds` commits only
to fixing or refunding things that are broken (failed download, wrong
render, double charge) and states that personalized instant downloads
aren't automatically refundable on a change of mind. **Nothing to change.**
Do not let a later pass quietly add a window.

---

## 11. SEO (§34) — preserved, two consequential edits

The slug rename is the only thing that touches SEO, and almost everything
adapts automatically because it derives from the registry: sitemap entries,
canonical, hreflang, OG image routes, Product/Offer/Breadcrumb schema and
`generateStaticParams` all rebuild from `slug`.

**Two things do not auto-adapt:**
1. **301 redirects** from `/products/heart-map` (§1a).
2. `Products.whereWeMet.meta.title` / `.description` × 3 locales — hand-written
   per product, so they need the new name.

Also outstanding from the earlier review, not contradicted by your
document: homepage FAQ has no `FAQPage` schema while product pages do; no
`sameAs` on Organization. Both preserve-and-add, not corrections.

---

## 12. NO CHANGES NEEDED (verified against §35, §36, §37)

- **§35 Multilingual** — `src/proxy.ts` reads only q-weighted
  `Accept-Language`; geo-IP code is gone. Verified against a running
  server: `ar-DZ`→`/ar`, `fr-FR`→`/fr`, `en-US`→`/en`, other→`/en`, and
  cookie beats browser. RTL and Arabic typography in place.
- **§36 Theme** — theme lives outside React (`useSyncExternalStore` +
  `localStorage`) and is re-asserted after every render; survives locale
  change, navigation and refresh. **Regression risk: none of this pass's
  changes touch it**, but re-test after, since the original bug was a
  locale/layout interaction.
- **§37 Arabic OG** — English fallback in place and documented in
  `src/lib/og.tsx`. No complicated renderer introduced.
- **§28 Paddle** — no Paddle code anywhere. Still missing for eventual
  review: seller legal identity, acceptable-use/content policy, real policy
  dates. Not in this pass's scope.

---

## 13. SUGGESTED SEQUENCE

Assuming B1–B6 are answered:

1. **Naming** — id/slug split, Where We Met rename, redirects, message
   renames. Everything downstream depends on it.
2. **Funnel** — split `getCreateEntry` from `getStudioDestination`,
   repoint CTAs, update labels.
3. **Claims** — apply the §4 table exactly as you sign it off.
4. **Pricing section** — derived "From $12 USD".
5. **Digital terminology** — per-product offering overrides + copy rewrite.
6. **Collection + hero + definition line** — headline, featured, hero
   composition, plain-language definition.
7. **Celestial copy debias.**
8. **Verify** — typecheck, lint, build, then re-test theme + locale +
   Arabic together.

Steps 1–4 are the P0 set and are independently shippable. 5 is the one
carrying an architectural change. 6–7 depend on B1/B2/B5.
