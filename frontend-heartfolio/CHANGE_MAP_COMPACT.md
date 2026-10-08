# Heartfolio — Change Map (compact)

Inspection only, no code changed. Refs are file:line in the current repo.

## BLOCKERS (decide first)

- **B1** Registry has 4 products (`star-map`, `song-poster`, `heart-map`, `love-story-timeline`). Missing: Moon Phase, Birth Poster, Wedding Keepsake, Pet Memorial. Each needs name ×3 locales, descriptions, story, meta, 3 FAQs, offerings, prices, artwork. Cannot be invented.
- **B2** §5 hero wants a Birth Poster glimpse — doesn't exist. Resolve B1 or substitute Song Poster.
- **B3** All 4 products are `waitlist`/`coming_soon`. Does a product CTA always go to `/create?product=`, or only when `status: "available"`?
- **B4** §9 (Digital ≠ file) vs §30 (leave PNG/PDF alone) collide on one string: `Products.offeringDetails.digitalFiles` = "High-resolution PNG · instant download". Keep / drop / replace?
- **B5** Celestial = brand or Star Map's? The design system *is* celestial (`--color-ink-navy`, `StarField`, `CelestialSequence`, `ConstellationMark`). Copy debias is contained; visual debias is a rebrand (§39 forbids).
- **B6** Approve the slug migration in §1 (affects Supabase waitlist rows).

## 1. Naming — P0

**heart-map → Where We Met. Change slug, keep id.**

| Field | Now | Proposed |
|---|---|---|
| `id` | `heart-map` | unchanged — it's `waitlist_entries.product_id`; zero data migration |
| `slug` | `heart-map` | `where-we-met` |
| `i18nKey` | `heartMap` | `whereWeMet` |
| new | — | `previousSlugs: ["heart-map"]` → 301s |

Files: `registry.ts:74-82` · `types.ts` (add field) · `next.config.ts` (301s) · `messages/{en,fr,ar}.json` (rename namespace + display name) · body copy naming the old product (`whereWeMet.story` opens "A **Heart Map** takes…") · `hero.tsx:62,164` · `STUDIO_INTEGRATION_GUIDE.md`.
`keepsake-visual.tsx:95` keys on id → **no change** if id stays.
**Needs approval:** FR/AR display names (suggest "Là où nous nous sommes rencontrés" / "حيث التقينا", or leave untranslated).

Star Map: no change, Moon Phase is separate (see B1). "Timeline Poster" appears **nowhere** in code — §2 already satisfied.

## 2. `/create` + CTAs — P0

`/create` **already** reads `?product=` and preselects (`create/page.tsx:14`). Keep it.

**Bug:** `getCreateDestination()` (`registry.ts:~130`) serves two jobs. Split:
- `getCreateEntry()` → `/create?product=<slug>` (marketing CTAs)
- `getStudioDestination()` → Studio/waitlist (Continue button only, per B3)

| File:line | Now | Required |
|---|---|---|
| `header.tsx:56,112` | `/create` | ✅ label only |
| `hero.tsx:131` | `/products` | your call |
| `pricing.tsx:74`, `final-cta.tsx:41` | `/create` | ✅ |
| `gift-occasions.tsx:75` (all 5) | `/create` | `/products?occasion=<key>` (§25) |
| `product-view.tsx` CTA | `/studio/:slug` \| `/waitlist?product=` | **`/create?product=<slug>`** |
| `product-card.tsx:113` Continue | Studio/waitlist | ✅ keep (this is the exit) |

Labels: `Nav.cta` → "Create a keepsake"; `ProductPage.createYours` → "Create your keepsake"; `FinalCta.cta`/`Pricing.single.cta` align.

## 3. Homepage pricing — P0

`pricing.tsx` + `Pricing` ×3 locales.
- `title` "One honest price." → "Simple, transparent pricing."
- `single.price` hardcoded `"$12"` → **derived** min of `getStartingPrice()`, shown "From $12 USD"
- `subtitle` += "Each keepsake has its own available formats and pricing"
- `features[4]` keep mechanic, drop "the sky"
- `features[5]` "Redownload anytime, no expiry" → **REMOVE**
- `reassurance` "Secure checkout. Delivered to your inbox instantly." → §20 wording
- Restructure so it stops reading as one universal price; link to `/products`

## 4. Claim audit — P0 (sign off line by line)

**REMOVE (accounts/permanence, §21–22):**
`Faq.items.lost.answer` ("lives in your account for good") · `Faq.items.reorder.answer` ("your design lives in your account") · `WhyHeartfolio.pillars.instant` ("redownload, always") · `WhyHeartfolio.comparison.us.points[3]` ("Yours to redownload, forever") · `Pricing.single.features[5]` · `ProductPage.included.items[5]` · `FinalCta.trust` ("Yours to keep forever") · `Nav.secondary.track`/`.account` (dead keys, still in all 3 files)
⚠️ `Faq.lost` and `Faq.reorder` are *entire entries* built on accounts — FAQ loses two items.

**REWRITE:**
`Faq.items.preview.answer` ("true render of your paper, frame, and colors" — contradicts digital-first) · `ProductPage.included.items[4]` → §19 wording · `Hero.subhead` ("digital file you can print, frame") · `Hero.trust` ("Yours to keep") · `Legal.contact.sections[3]` ("We answer every request") · `GiftOccasions.newBaby.cta` ("Create a birth keepsake") · `GiftOccasions.inMemory.cta` ("Create a memorial print")

**KEEP (§30):** Hero headline · "We're not a design tool. We're a craftsman." · customize-before-buy · download-after-purchase.

**VERIFY LATER:** 300 DPI · print-ready PDF · high-res PNG · "up to 24″ × 36″" · "instant download" (×6) · Star Map "real astronomical data" · Song Poster "actual waveform" + **"no audio is sold, included or distributed"** (legal) · Where We Met "real street geometry" (Mapbox token in `.env.local` — check redistribution terms) · "up to five milestones" · "art-directed by hand" · the 4 named moods · `HowItWorks.two` "rendered slowly in front of you".
⚠️ Several sit inside `FAQPage` structured data — machine-readable.

## 5. Digital terminology — P0, only architectural change

Offering copy is **global**: `Products.offerings.digital.description` is one string for every product. §9 needs product-specific meaning → add per-product overrides with fallback:
`Products.<product>.offerings.<type>.description` → fallback `Products.offerings.<type>.description`.
Affects `product-view.tsx` (tOffer lookup) + 3 message files.

File-framed copy to rewrite: `offerings.digital.description` · `offeringDetails.digitalFiles` (B4) · `ProductPage.digitalNotice` · `ProductPage.included.items[1..2]` · `FeaturedKeepsakes.digitalNote` · `Collection.digitalNote` · `Footer.digitalNotice`.
**Constraint:** "no physical item / nothing shipped / printing not included" must survive — Paddle needs it (§28). Change emphasis, not facts.
**Complete Pack:** description hardcodes "screen, print and phone" — wrong for a Digital+AR+VR pack. Make generic or add `includes: OfferingType[]`.

## 6. Collection section — P1

`FeaturedKeepsakes.title` → "A keepsake for every kind of moment." ×3 · `cta` → "Explore all keepsakes" · `subtitle` implies exactly four, generalise.
~4-featured mechanism **already exists** (`getFeaturedProducts()` on `featured: true`) — nothing to build. But "Explore all" leads to `/products` showing the same four until B1.

## 7. Hero — P1

`hero.tsx`: line 84 dominant `star-map` → `love-story-timeline` · line 62 glimpse → `where-we-met` · second glimpse → Birth Poster (B2) · line 164 mobile strip order.
**Add §7 definition as visible copy** under the headline ("Beautiful personalized digital keepsakes for the moments worth remembering") — new key ×3. Also fixes the §34 gap: the homepage never says what Heartfolio is outside `<meta>`/JSON-LD.
Background `CelestialSequence`/`StarField` → blocked on B5.

## 8. Celestial copy debias — P1

`HowItWorks.steps.two` ("Your **sky**, your street") · `Pricing.single.features[4]` ("the sky") · `Faq.items.incomplete.answer` (a Star Map answer in brand position) · `TemplateGallery.items.midnight` ("Deep navy skies") · `.vintageChart` ("astronomy-chart linework") · Faq generally reads as one product's FAQ.

## 9. Support email — P0

`site-config.ts:22` → `heartfolioapp@gmail.com`. One constant → footer, 4 legal pages (`{email}`, 9 spots ×3 locales), `Organization.email` + `contactPoint.email`. Remove TODO.

## 10. Refund — no change

Verified: no period stated anywhere. Commits only to fixing/refunding broken things. Don't let a later pass add a window.

## 11. SEO — preserved; 2 manual edits

Sitemap, canonical, hreflang, OG routes, Product/Offer/Breadcrumb schema and `generateStaticParams` all derive from `slug` → auto-adapt. Manual: **301 redirects** from `/products/heart-map`, and `Products.whereWeMet.meta.title`/`.description` ×3 (hand-written).
Outstanding (not contradicted): homepage FAQ has no `FAQPage` schema; no `sameAs` on Organization.

## 12. Verified, no changes (§35/§36/§37/§28)

Language: `proxy.ts` reads only `Accept-Language`, geo-IP gone; tested `ar-DZ`→`/ar`, `fr-FR`→`/fr`, `en-US`→`/en`, cookie beats browser.
Theme: outside React (`useSyncExternalStore` + `localStorage`), re-asserted each render; survives locale/nav/refresh. Re-test after this pass anyway.
Arabic OG: English fallback documented in `og.tsx`.
Paddle: no code. Still missing for review: seller legal identity, acceptable-use policy, real policy dates.

## 13. Sequence

1 Naming → 2 Funnel split → 3 Pricing → 4 Claims (**1–4 = P0, independently shippable**) → 5 Digital terminology (architectural) → 6 Collection/hero/definition → 7 Celestial debias → 8 Verify (typecheck, lint, build, then theme + locale + Arabic together).
6–7 depend on B1/B2/B5.
