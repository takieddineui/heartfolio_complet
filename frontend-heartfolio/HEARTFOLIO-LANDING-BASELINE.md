# Heartfolio — Landing Page Baseline

**Snapshot date:** 2026-08-25

---

## 1. Status

- **Pass A: 34/34 complete** (naming, funnel, pricing, claims, SEO, i18n audited and verified against a running build)
- **Pass B: complete** (visual/brand refinement — hero, product gallery, How It Works, artwork enrichment)
- **Landing page baseline: complete**
- **Current phase: maintenance-only until pre-deployment.** No further landing-page redesign should occur during normal product development. Deferred work is enumerated in §10 and marked in code with `TODO(HEARTFOLIO-PREDEPLOY)` comments.

---

## 2. Current approved product identity

- Heartfolio is a collection of personalized digital keepsakes — not a single-product (celestial) brand.
- **Star Map** and **Moon Phase** are separate products. Do not merge them or rename Star Map to Moon Phase.
- **Where We Met** is the approved public name for the former "Heart Map." Its `slug` is `where-we-met`; its `id` remains `heart-map` (existing Supabase waitlist rows key on this) and `heart-map` is retained in `previousSlugs` purely for permanent-redirect compatibility.
- **Love Story Timeline** remains its own product (also referred to as "Timeline Poster" in early discussion — same product, one name in the codebase: Love Story Timeline).
- Currently implemented in the registry: **Star Map, Song Poster, Where We Met, Love Story Timeline.**
- **Moon Phase, Birth Poster, Wedding Keepsake, and Pet Memorial are not implemented.** Do not fabricate their content, names, artwork, or FAQs — add them only when real product content exists.

---

## 3. Current CTA architecture

- **Global/collection CTA** → `/create` (no product preselected)
- **Product CTA** (product pages, pricing, final CTA, header) → `/create?product=<slug>`
- `/create?product=<slug>` preselects the requested product; the visitor can still change the selection before continuing.
- The **Continue button** inside `/create` retains the product's actual destination based on `status`:
  - `available` → `/studio/:slug` (route does not exist yet)
  - `waitlist` → `/waitlist?product=:slug`
  - `coming_soon` / `disabled` → unavailable state
- This split is implemented as two functions in `src/lib/products/registry.ts`: `getCreateEntry()` (marketing CTA) and `getStudioDestination()` (Continue button only). Do not collapse them back into one function.
- **Studio itself (customization, live preview, payment, generation, download) is outside this phase** and is not implemented or modified here.

---

## 4. Current pricing

- Prices are **provisional development values** (`$8` / `$12` / `$18` / `$30`), not final commercial figures.
- Homepage pricing (`Pricing` section) is **derived** from `getStartingPrice()` across the product registry — never a hardcoded universal figure. Verified: it currently renders `From $8 USD`.
- Per-product starting prices on cards and product pages are likewise derived, never hardcoded.
- **Do not treat current prices as final Paddle catalogue prices.** Final pricing will come from the Django Products API/database.

---

## 5. Current digital terminology

- **"Digital" means the digital/web experience of the keepsake — not simply PNG/PDF.**
- Different products may eventually have different available formats/experiences (Digital, Printable, Wallpaper, AR, VR, Complete Pack) — only offerings a product actually has are ever rendered; none are invented.
- **Product-specific Digital descriptions now support overrides with global fallback**, implemented in `src/components/product/product-view.tsx` (`getOfferingDescription()`): it checks `Products.<i18nKey>.offerings.<type>.description` first, falling back to the shared `Products.offerings.<type>.description`. Currently overridden for Where We Met and Love Story Timeline's Digital offering; all other offerings on all products use the shared copy.

---

## 6. Current business/access decisions

- User can edit/customize and preview their keepsake as many times as desired **before payment**.
- Download happens **after purchase**.
- Purchased files are intended to be **delivered by email**.
- Source/input assets stored in R2 may eventually be **deleted after approximately 15 days**.
- **Permanent/lifetime access is NOT promised** anywhere in the app — this was explicitly removed in Pass A (account-based "redownload forever" claims) and a guardrail comment exists in `product-view.tsx` and `site-config.ts` warning against reintroducing it.
- **No authentication/account system** is implemented in this phase.
- **Future recovery/re-delivery policy is undecided** — flagged with a TODO near `SUPPORT_EMAIL`.

---

## 7. Support

`support@theheartfolio.com` — set once in `src/lib/site-config.ts` (`SUPPORT_EMAIL`), consumed by the footer, all four legal pages, and Organization/contactPoint structured data.

---

## 8. Paddle

- **No Paddle integration in this phase.** No checkout. No payment code.
- The public site is structured to be Paddle-friendly (digital-goods clarity, USD pricing, Terms/Privacy/Refund policy, support contact) but has not been audited against Paddle's actual merchant requirements.
- **A future Paddle/Merchant-of-Record readiness audit remains outstanding**, including seller legal identity, acceptable-use/content policy, and finalized pricing.

---

## 9. Deferred pre-deployment work

All of the following are intentionally deferred and marked in code with `TODO(HEARTFOLIO-PREDEPLOY)` comments (see file list below):

- Replace temporary/generated product artwork with final premium Heartfolio artwork — `src/components/product/keepsake-visual.tsx`
- Replace temporary offering mockups with final product/format presentation — `src/components/product/offering-visual.tsx`
- Re-evaluate the Why Heartfolio comparison section (currently reads slightly SaaS-comparison-like) — `src/components/sections/why-heartfolio.tsx`
- Re-evaluate small Digital/download visual cues — `src/components/sections/featured-keepsakes.tsx`, `src/components/product/product-view.tsx`
- Replace static product data with the Django Products API — `src/lib/products/registry.ts` (header comment)
- Replace provisional pricing with database-driven final pricing, post Paddle catalogue audit — `src/lib/products/registry.ts` (header comment)
- Final product/occasion relationships from the database, replacing the temporary tag-based map — `src/lib/products/registry.ts` (`OCCASION_TAGS`)
- Studio integration (route, hand-off contract) — `src/lib/products/registry.ts` (`getStudioDestination`)
- Final commercial/legal/Paddle audit — see §8
- Final production SEO/accessibility/performance audit — not yet performed at production-traffic scale
- Final device/RTL QA — verified via headless browser screenshots (desktop/tablet/mobile/Arabic) during Pass B; not yet verified on physical devices

---

## 10. Brand direction (must be preserved)

Heartfolio should remain: **premium, artistic, emotional, editorial, luxurious, calm, intimate, modern, subtly magical, subtly technology-forward.**

It must **not** become a generic AI SaaS, dashboard-like product, or feature-grid-heavy marketing site.

---

## 11. Explicit guardrails for future work

- Do not merge Star Map and Moon Phase.
- Do not turn Heartfolio into a single-product celestial brand — the hero's dominant piece is Love Story Timeline; Star Map is a supporting glimpse, not the lead.
- Do not add AI marketing claims ("AI-powered," etc.).
- Do not add fake testimonials, fake statistics, or fabricated social proof.
- Do not add SaaS-style pricing tiers (Free/Pro/Business/Enterprise) — Heartfolio has no subscription model.
- Do not redesign the landing page during normal product development; treat it as frozen until the pre-deployment phase, except for fixing genuine regressions.
- Do not reintroduce permanent-account or lifetime-redownload claims without an explicit business decision (see §6).

---

## 12. Validation at time of this snapshot

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Clean |
| ESLint | Clean |
| Production build | Clean — all routes generated across `en`/`fr`/`ar` |
| `/en`, `/en/products`, `/en/products/love-story-timeline`, `/en/products/where-we-met`, `/fr`, `/ar` | All HTTP 200, zero console/page errors |
| `/en/products/heart-map` | Redirects (308) to `/en/products/where-we-met` |
| `/en/create?product=where-we-met` | Preselects Where We Met correctly |
| Theme | Persists through toggle → locale switch (dark→light survives EN→FR) |
| RTL | `/ar` renders `dir="rtl"` |
| Pricing | Homepage shows derived `From $8 USD` / `From $12 USD`, not a hardcoded figure |
| Offering description override | Where We Met's Digital card renders its product-specific text; unaffected offerings still show shared copy |

This snapshot was validated with the repository in this exact state — no code was changed while producing it.
