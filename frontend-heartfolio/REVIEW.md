# Heartfolio — Implementation Review (condensed)

Analysis only. No code changed. Every finding below comes from reading the
current code and from a running production build.

---

## Decisions I need from you (blocking Pass A)

1. **Moon Phase vs Star Map** — is the existing `star-map` product actually a moon phase, a genuine star map, or are they two separate products? (See §2.)
2. **The claim audit** — which of the ~30 statements in §10 are true, intended, or wrong?

Everything else can proceed without you.

---

## 1. Support email

Single constant, `SUPPORT_EMAIL` in `src/lib/site-config.ts`. Flows to 5 places:

- `site-config.ts:22` — definition + TODO
- `footer.tsx` — visible mailto, every page
- `legal-page.tsx` — substitutes `{email}` across Privacy, Terms, Refunds, Contact (9 occurrences × 3 locales)
- `[locale]/page.tsx` — `Organization.email` and `contactPoint.email` in JSON-LD
- `CHANGES.md` / README — docs

One-line change plus removing the TODO. Nothing else hardcodes an address.

⚠️ Gmail is fine for the landing phase, but Paddle review generally expects support contact on the business domain. Free webmail is a common flag. Pre-Paddle checklist item.

---

## 2. Product names — what actually exists

**`star-map` / `starMap`** — seeded star field artwork with date + coordinates. All copy is about a computed night sky: "calculated from real astronomical data for the date, time and coordinates", "change the time by an hour and the sky changes".

**`heart-map` / `heartMap`** — fine-line street geometry with a single heart marker. Copy is about the exact spot something began.

### Answers

- **Where We Met = `heart-map`, cleanly.** Same product, better name. Artwork, copy, FAQ and schema all remain correct. Low risk.
- **Moon Phase ≠ Star Map.** Different products, not two names for one. A moon phase shows one lunar phase for a date; a star map shows a whole sky. Renaming `star-map` → Moon Phase would falsify the artwork (a star field), the story ("the arrangement of stars above a particular place") and all three FAQ entries. It's a product swap, not a rename. Three possibilities, and only you can pick:
  - (a) the studio generates moon phases and "Star Map" was always the wrong label → rename + new artwork + rewritten copy
  - (b) it generates star maps and Moon Phase is a separate future product → keep Star Map, add Moon Phase later
  - (c) both are planned → two registry entries
- **Are they leftover old naming?** Can't tell from code, won't guess. They're consistent across registry, all three message files, bespoke artwork and the Studio integration guide — which reads deliberate rather than vestigial.

### Slug dependencies that make renaming non-trivial

1. **Live indexed URLs** — `/products/star-map` is in the sitemap. Needs 301s from old slugs.
2. **Supabase `waitlist_entries`** — the API route writes `product_id` / `product_name` as free text. Existing rows hold `star-map` / "Star Map". Needs a migration or alias map, or waitlist segmentation breaks silently.
3. **`keepsake-visual.tsx`** switches on `productId` string literals.
4. **`hero.tsx`** hardcodes four ids in two places.
5. **Fallback i18n keys** — `product-card.tsx:94` and `waitlist/page.tsx:20` fall back to the literal `"starMap"` namespace.
6. **`STUDIO_INTEGRATION_GUIDE.md`** uses `star-map` in example hand-off URLs.

Not blockers — roughly 45 minutes with redirects — but 1 and 2 bite later if skipped.

**Recommendation:** decouple `id` / `slug` / display name now while it's cheap. `id` = stable internal key that never changes (and that Django will key on); `slug` = renameable URL with a `previousSlugs: []` array driving redirects; name stays in messages. Makes future renames and the API migration a data change, not a code change.

---

## 3. Prices are data-driven — confirmed, one caveat

Prices are numeric in `ProductOffering.price`, currency per-offering, the "from" figure is *derived* (`getStartingPrice` = min of available offerings), display goes through `formatPrice()`. Nothing hardcodes a price string — **except** the legacy landing `Pricing` section (§6) and the `$12` written into product `meta.description` prose, which will drift when prices change.

⚠️ **The real migration caveat:** `getAllProducts()` is currently called *inside client components* — `FeaturedKeepsakes`, `SiteFooter`, `create/page.tsx`. Fine while synchronous; when it becomes an async API call those three must move to server components passing props down. `ProductCollection` and `ProductView` already take props, so they're fine. 20 minutes now, a refactor later.

`formatPrice` is USD-shaped (`$12 USD`); a second currency would mean `Intl.NumberFormat`. Fine per your USD-only rule.

---

## 4. Offering model sufficiency

`type / name / price / currency / detailsKey / available / media` covers today. No architectural issue — the model is right-shaped, just minimal. What I'd expect to need, by likelihood:

- **`id` / external price reference** — Paddle needs a price ID per offering. Without one you're matching on `productSlug + type`, which breaks with two digital tiers.
- **`includes: OfferingType[]` on Complete Pack** — a pack is currently opaque; the UI can't say what's in it or validate that the bundle beats buying separately.
- **`order`** — display order is array order; unreliable from an API.
- **Structured file specs** alongside `detailsKey` — the key points at a translated sentence, good for display, useless for logic.
- **`available` as a status, not a boolean** — you'll want "AR coming soon" on a live product. Boolean forces hiding it entirely (correct today per §11, but no option later).
- **`compareAtPrice`** if you ever bundle-discount.

All additive.

---

## 5. Presentation vs selection — confirmed on product pages, broken elsewhere

`product-view.tsx` is clean: no `<input>`, no `<select>`, no radio, no quantity, no state at all. Offerings render as read-only panels. One CTA component, used twice, destination from `getCreateDestination()`.

⚠️ **But `/create` still exists and it *is* a selector** — selectable cards, `selectedSlug` state, Continue button. It now duplicates `/products` with a worse experience, and it still owns most CTAs: header, mobile sticky, Gift Occasions, Pricing, Final CTA.

That's an inconsistency I introduced and didn't resolve — I built the presentation funnel but left the old picker wired to the buttons. **Recommendation: fold `/create` into `/products`, repoint every CTA, leave product selection to Studio.**

---

## 6. Landing pricing section — keep it, reframe it

**Keep it.** Removing hurts three ways: Paddle reviewers look for pricing visible pre-checkout; "how much does a personalized star map cost" is real intent; hiding price on a gift site reads as evasive.

**But "One honest price" is already inaccurate, not just future-risky** — the landing shows a $12 universal price three sections above product pages showing four prices up to $30.

Proposed:
- Title: "Simple, transparent pricing" (or "Priced per keepsake, not per subscription")
- Figure: **"From $12 USD"**, derived from `Math.min` across the registry so it can't drift
- Three or four lines explaining the *model*: digital download, each keepsake has its own versions and prices, USD, no subscription, no shipping
- One link: "See prices for each keepsake" → `/products`
- Keep the digital-goods clarity block (formats, no printing/framing) — the Paddle-relevant part and the strongest content there

Don't list every offering on the landing page. Agreed.

---

## 7. "Four ways to keep the same feeling"

My line, and a genuine miss. It reads as four *formats* of one product — exactly the confusion the brief exists to prevent.

**"A keepsake for every kind of moment"** is the better of your two: says collection *and* breadth of occasion, and sets up Gift Occasions below. "Choose the moment worth keeping" is more evocative but narrower.

Separately: **don't hardcode counts anywhere.** "Four ways" breaks the day Birth Poster ships. Audit for numbers-in-copy across all three locales.

---

## 8. Does it read as a multi-product brand? Honestly, no

The hero is better — neutral headline, three pieces, mobile strip of four. **But the dominant piece is still the star map**: largest, brightest, most detailed element on the page.

More importantly the celestial bias runs deeper than the hero, and I didn't fix it:

- **Template Gallery moods** are sky-coded: "Deep navy skies", "Antique astronomy-chart linework", "moments that happened after dark" — three of four read as star map moods
- **The homepage FAQ is a star map FAQ** — "What if I don't know the exact time or location?" → "An approximate time still renders a beautiful, accurate sky." One product's FAQ presented as the brand's
- **Pricing features**: "Adjust the date, the words, **the sky**"
- **How It Works** step two: "Your sky, your street, your story"
- The whole visual system — `ink-navy`, star fields, `CelestialSequence` in hero and final CTA, the constellation footer mark — is a night sky

**The hard question is a brand decision, not a code one: is the celestial motif Heartfolio's identity, or is it Star Map's identity that leaked into the brand?** If the brand's, it's fine and rather beautiful and only copy needs debiasing. If leakage, the visual system needs work far beyond the hero.

If you want another hero iteration: make the dominant piece non-sky (Where We Met or Love Story Timeline read as more universally "gift"), demote the star map to a glimpse, and add one definitional line under the headline (also helps §16).

---

## 9. Visuals — what's real

**Nothing is photographic. Everything is generated SVG.**

| Asset | Status |
|---|---|
| Star Map artwork | SVG — seeded star field, date, coordinates. Genuinely decent |
| Song Poster artwork | SVG — waveform, hover animation. Decent |
| Heart Map artwork | SVG — street lines + beating heart marker. Decent |
| Love Story Timeline | SVG — five-moment spine. Mine; the weakest |
| Offering frames | CSS+SVG — bordered rect, phone-shaped rounded rect. Functional, not premium |
| OG cards | Generated at build. Real and usable |
| Per-product photography | Missing entirely |
| Hero composition art | Missing — three floating scaled SVGs |

**Key distinction:** these are placeholder *representations* of the artwork, not the artwork. The most valuable next asset isn't a mockup — it's **real final outputs from the actual generator**. Once those exist, mockups are trivial (drop a real PNG into a frame). Building beautiful mockups around fake artwork is the wrong order.

Priority:
1. **Real generated artwork exports** — one hero-quality output per product. Everything depends on these
2. **Printable framed mockup** — highest commercial impact; the $18 offering people can't picture
3. **Wallpaper phone mockup** — cheapest to make convincing; the $8 offering currently looks like a grey rectangle
4. **Hero composition** — one art-directed image beats three floating divs
5. **Complete Pack composition** — overhead of the three together
6. **Per-product OG photography** — generated cards are fine; this is polish

Custom-designed, not stock, for all. For frames and phones: a bought or shot *empty* frame/device photo with real artwork composited in — not a stock living room with a generic print. AR/VR: nothing until they exist; a demo visual for an unbuilt feature is the definition of an unsupported claim.

---

## 10. Unsupported product/Studio claims — full inventory

All describe behaviour that doesn't exist yet. Nothing removed.

**Live-preview**
- `HowItWorks.two` — "rendered slowly in front of you, like a photograph developing"
- ⚠️ `Faq.preview` — "a true render of your **paper, frame, and colors**, not a mockup". Worse than unsupported: it *contradicts* digital-only

**Guided flow**
- `HowItWorks.one` — "One question at a time, nothing else on the screen"
- `HowItWorks.three` / `TemplateGallery` — "a few beautiful moods"; the gallery names four specific ones (Midnight, Warm Ivory, Vintage Chart, Golden Hour) that must actually ship
- `Faq.incomplete` — "we'll gently guide you if something's missing"

**⚠️ Account / persistence — highest risk group. There are no accounts: no auth, no user table, only a waitlist.**
- `Faq.lost` — "Your keepsake lives in **your account** for good"
- `Faq.reorder` — "your design lives in **your account** exactly as you made it"
- `WhyHeartfolio.pillars.instant` — "yours to redownload, **always**"
- `WhyHeartfolio.comparison` — "Yours to redownload, **forever**"
- `Pricing.features` — "Redownload anytime, no expiry"
- `ProductPage.included` (mine) — "Access to redownload your files whenever you need them"

"Forever" is also a commitment you may not want in writing before Paddle review.

**Editing**
- `Pricing.features` and `Faq.mistake` — "adjust... as many times as you like before you buy"
- `ProductPage.included` (mine) — "Unlimited changes to your details before you download"

**Delivery / checkout**
- `Pricing.reassurance` — "**Secure checkout.** Delivered to your inbox instantly" — asserts both a checkout and email delivery
- `WhyHeartfolio.pillars.instant` — "delivered the moment you buy"

**File specs — confirm against the real generator**
- "300 DPI", "print-ready PDF", "prints cleanly up to 24″ × 36″" (`Faq.sizing`), "high-resolution PNG"

**Product-specific claims I wrote — verify each**
- Star Map — "calculated from real astronomical data", "change the time by an hour and the sky changes"
- Song Poster — "the actual waveform of the track you choose"; also "no audio is sold, included or distributed" (a legal statement — confirm it's accurate)
- Heart Map — "real street geometry, redrawn rather than a screenshot". There's a Mapbox token in `.env.local`; verify what's actually rendered and check Mapbox's terms on redistribution
- Love Story Timeline — "up to five milestones"

**Occasion claims**
- Gift Occasions offers "Create a **birth keepsake**" and "Create a **memorial print**" — neither Birth Poster nor Pet Memorial exists

⚠️ **Structural note:** several of these sit inside `FAQPage` structured data on product pages. False claims in schema are worse than in copy — Google treats them as machine-readable assertions.

---

## 11. "Why Heartfolio" — claim classification

| Claim | Verdict |
|---|---|
| "We're not a design tool. We're a craftsman." | **A** — positioning, not functional. Safe and good |
| "A few beautiful moods" | **B** — safe *if* the four named moods ship |
| "Guided, one moment at a time" | **B** — describes Studio UX; safe once Studio matches |
| "High-resolution files, instantly" | **B** — central to the offer; must be true at launch |
| "Yours to redownload, forever" | **C** — reword. Unbounded, and no account system holds the files |
| "Every mood is art-directed by hand" | **A/C** — true *if* a human designs each mood. If ever algorithmic or AI-generated it becomes false, and it's the kind people notice |
| "delivered the moment you buy" | **B** — intended |
| "the way a florist or a jeweler would" | **A** — simile, safe |

Strong section. Only "forever" genuinely needs changing; "art-directed by hand" needs a factual confirmation from you.

---

## 12. Gift Occasions — strategically the best section on the page

Keep it, invest in it:
- The only part of the site organised around **what the buyer wants** rather than what you make. "Anniversary gift" is the real query; "star map" is not
- Broadens past couples — exactly the multi-product framing §8 needs
- Maps onto data you already have: `ProductEntry.tags` holds `anniversary`, `wedding`, `birth`, `map`, `music`

Currently all five cards link to `/create`, a dead end that ignores the occasion.

**Recommendation: a real taxonomy — `/[locale]/occasions/[slug]`, products filtered by tag.** Five more indexable high-intent pages, each with its own metadata and CollectionPage schema. Highest-ROI SEO move available; the data model already supports it. Not this pass, but soon.

Interim: link to `/products` (or `/products?occasion=…`) so nothing promises a filter that doesn't filter, and fix the two CTAs naming unbuilt products.

---

## 13. Paddle readiness

**Covered:** what's sold; digital nature (footer on every page, product pages, Terms, Refunds); what the buyer receives; prices visible pre-purchase; USD stated; delivery method; support route; Terms; Privacy; Refunds; explicit "no physical shipment"; "printing and framing not included".

**Missing:**
1. **Seller identity** — nothing says who Heartfolio legally is: trading name, entity, country, registered address. Standard requirement, flat gap
2. **A working checkout** — Paddle reviews a live purchasable flow. Everything here is pre-purchase presentation, right for now, but review can't pass until something can be bought. Be clear-eyed about sequencing
3. **Acceptable-use / content policy** — buyers supply names, photos, song titles. You need prohibited-content terms and an IP-complaint route. Song Poster and any photo feature make this concrete
4. **Delivery timeframe as a commitment**, not prose
5. **Support response expectation** — "we answer every request" with no window is thin
6. **Cookie/consent notice** the moment analytics appear. Nothing tracks today — don't add analytics without it
7. **Real "last updated" dates** — mine say "reviewed before each release", honest but not what a reviewer expects
8. **Domain support address** (§1)

---

## 14. Legal pages — remaining unsupported claims

Correct that no refund window is invented. Remaining:

- **Terms and Refunds describe an active sales process** ("payments are processed by our payment provider", "as soon as payment is confirmed") when nothing can be bought. Not false as forward-looking terms, but a reviewer today sees terms describing an impossible transaction. Note it, or accept as pre-launch terms
- **"We answer every request"** (Contact) — absolute commitment, no qualifier
- ⚠️ **Biggest legal gap: the FAQ and the Privacy Policy disagree about data retention.** The FAQ claims keepsakes live in an account; Privacy never mentions storing generated artwork or user-uploaded photos. If Studio stores designs, Privacy is incomplete
- **"we do not sell them"** — safe and true, keep
- **"we will fix the problem or refund you"** — a real commitment; make sure you'll honour it
- **The `{email}` substitution** means one wrong constant propagates to four policies in three languages

---

## 15. SEO — verified in served HTML from a production build

✅ Canonical (per page, per locale, self-referencing) · hreflang en/fr/ar + `x-default` → `/en` on every page · localized metadata per locale per product · Product schema with Brand, category, per-offering Offers · Offer schema with price, currency, availability (`PreOrder` for waitlist products — honest) · FAQPage on product pages matching the visible accordion · BreadcrumbList matching the visible breadcrumb · Organization + WebSite with contactPoint and availableLanguage · sitemap every route × locale with `xhtml:link` alternates · robots allow-all, disallow `/api/`, sitemap + host

**Gaps:**
- **Homepage FAQ has no FAQPage schema** while product pages do — inconsistent, and the homepage FAQ is more-visited
- **No `sameAs`** on Organization — a standard entity signal for search and AI
- **No `logo` as ImageObject**, just a URL string
- Product pages have no `inLanguage`

**Surviving the Django API:** shape survives; three things must change together — `generateStaticParams` becomes an async fetch, `sitemap.ts` becomes async, and you need revalidation (ISR tags or publish webhook) or product changes won't appear until redeploy. Protection: every SEO surface derives from registry functions rather than hardcoding, so it's four call sites, not a rewrite. The client-component call sites in §3 are the one genuine snag.

---

## 16. AI discoverability

**Already good:** semantic HTML and real headings; one indexable page per product with a distinct description; Organization with slogan, description, languages; prices and offerings as visible text not images; FAQ in both prose and schema; consistent vocabulary ("personalized digital keepsake") across all three languages; policies as crawlable text.

**Missing:**
- ⚠️ **The homepage never states what Heartfolio is in plain language.** The `<h1>` is "Some moments deserve more than a photo" — beautiful, but a model extracting "what is Heartfolio" gets poetry. The definition lives only in meta description and JSON-LD. One visible line near the top fixes it
- **No About page** — no single URL explaining the brand, which is what gets cited when a model summarises a company
- **No `sameAs`** to establish entity identity across the web
- **No occasion pages** (§12) — "good 10th anniversary gift" is exactly the query shape where an AI would surface you, and nothing answers it

None of this is gimmickry, just legibility. Foundation is solid; the brand-definition layer is thin.

---

## 17. Language behaviour — confirmed against a running server

| Browser | Result |
|---|---|
| `ar-DZ,ar;q=0.9,fr;q=0.8` | `/ar` ✅ |
| `fr-FR,fr;q=0.9,en;q=0.8` | `/fr` ✅ |
| `en-US,en;q=0.9` | `/en` ✅ |
| Any other language | `/en` ✅ |
| Cookie `NEXT_LOCALE=en` + French browser | `/en` ✅ |

Country is never read — the geo-header code is gone entirely. A direct `/ar` link always opens Arabic regardless of cookie or browser, correct for shared links.

**Behaviour to be aware of:** the cookie is written on first *detection*, not only on explicit choice. That's what stops detection re-running on every navigation (your §22), but a user who later changes their browser language keeps the originally-detected locale until they use the switcher. I believe that's what you want — flagging it so it's a decision, not a surprise.

---

## 18. Theme — confirmed by construction, not by clicking

Light and dark both work; dark is default; light persists once chosen; locale change no longer resets it; navigation and refresh preserve it; multiple tabs sync via the `storage` event.

**Why the bug happened:** `<html>` is rendered by `app/[locale]/layout.tsx`. Changing locale changes that segment's params, so React re-rendered the root layout and re-applied the element's attributes — wiping the `.dark` class, which the pre-paint script had added imperatively and which was never part of any React tree. The old provider held theme in `useState` initialised once from the DOM, so it never noticed.

**Why it can't recur:** theme now lives *outside* React (module state + `localStorage`, read via `useSyncExternalStore`), so a remount can't reset it, and an effect re-applies it to `<html>` after every render of the provider. Whatever React does to that element, the theme goes back.

⚠️ Verified by reasoning, typecheck and build — I had no browser to click the toggle in. Top of the manual-test list.

---

## 19. Arabic

**Changed:** `left/right` → `start/end`; `pl/pr` → `ps/pe`; `text-left` → `text-start` (accordion, FAQ search, waitlist form, pricing grid, create cards, skip link); arrows mirror via Tailwind's `rtl:` variant rather than JS locale checks; Latin letter-spacing suppressed under `.font-arabic` (`tracking-[0.18em]` severs Arabic letter joins — this was actively breaking words); Arabic headings get their own line-height (1.4); dedicated Arabic typefaces rather than a Latin face with fallback.

**Font loading confirmed:** both Arabic faces use `preload: false`, and their CSS variables are applied only on `/ar` via `fontClassNames()`. English and French visitors don't download them (~240KB saved). Verified in the served `<html class>`.

**Remaining risks, in order:**
1. **Offering panels alternate sides** via `md:[&>*:first-child]:order-2` — grid order under RTL is the classic breakage. Untested
2. **Hero composition** uses `start`/`end` so it flips left while text flips right — logically correct, visually unverified; overlap at some widths is plausible
3. **Mixed-direction strings** — "PNG · 300 DPI · حتى ٦٠ × ٩٠ سم" mixes Latin, digits and Arabic; the `·` separators and dimension order are known bidi trouble
4. **Prices** — "$12 USD" inside an RTL paragraph; currency symbol position is a bidi edge case
5. **`font-mono` offering-detail line** is styled uppercase + tracking for Latin; uppercase is meaningless in Arabic and the mono face may not cover it
6. **Line-height 1.4 is a guess** — applied to all Arabic h1–h3; the hero headline may need different treatment from a card heading
7. **FAQ accordion chevron** rotates vertically so it's fine, but `justify-between` is only correct if flex direction inherits properly. Untested
8. **Footer, breadcrumbs, product cards** should be fine (logical properties throughout) but unseen

Honest summary: the mechanical RTL work is done and the typography traps are addressed. Whether Arabic looks *intentionally designed* rather than merely mirrored is a question only a real device answers.

---

## 20. Arabic OG

Agreed. Documented at the top of `src/lib/og.tsx`: the reason (satori does no Arabic shaping or bidi reordering), the fallback (English card for the same product), and the eventual fix (headless browser screenshot, or Resvg with pre-shaped SVG). No complicated solution introduced.

---

## 21. What needs real-device testing

**Tablet (768–1024px):**
1. The hero composition disappears at `lg` (1024px) — tablets get the mobile strip with desktop-sized text; likely an awkward empty side
2. Offering panels go two-column at `md` (768px) — each column ~340px, phone mockup 110px wide in a 280px-tall box. Probably looks lost
3. Header nav shows desktop links from `md` plus switcher, toggle and CTA — tight at 768px, worse in French
4. Footer's four-column grid at `md` with French legal labels ("Politique de confidentialité") — likely wrapping badly

**Arabic:** the eight items in §19, with alternating offering panels and the hero composition as the top two.

**French:** runs ~20% longer than English. Pressure points: button labels ("Rejoindre la liste d'attente"), nav items, footer legal column.

**Manual test order:** theme toggle + language switch together (the actual bug) → Arabic product page top to bottom → tablet hero → offering panels at 768px and in Arabic → French footer and nav.

---

## 22. Honest critique — ranked

### P0 — must fix
1. **The landing page contradicts the product pages on price.** "One honest price / $12" sits three sections above pages showing four prices up to $30. Live and wrong today
2. **Unsupported claims, especially the account ones** — "lives in your account forever" with no auth; "a true render of your paper, frame, and colors" on a digital-only product. Some sit inside FAQ *structured data*
3. **`/create` duplicates `/products` and still owns most CTAs** — header, sticky CTA, pricing, final CTA and occasion cards all point at the old picker while the new presentation pages sit outside the main flow
4. **Product naming unresolved** (§2) — everything downstream hardens around whatever names exist. Cheapest to change now

### P1 — important
5. **The brand still reads celestial** — sky language in moods, FAQ, pricing features, How It Works; the star map dominates the hero. §8's core objective isn't met
6. **Gift Occasions promises products that don't exist**
7. **No seller identity anywhere** — flat Paddle gap
8. **The homepage never says what Heartfolio is** in plain visible language
9. **Registry called from client components** — blocks the API migration (§3)
10. **Homepage FAQ has no schema** while product pages do

### P2 — polish
11. "Four ways to keep the same feeling", and hardcoded counts generally
12. Love Story Timeline's SVG is the weakest of the four — and it's the product you most want to sell
13. Offering mockups are functional, not premium
14. Newsletter signup removed from the footer (was non-functional; you may want it back as a real feature)
15. `Meta` descriptions hardcode "$12" in prose
16. Policy pages have no real dates

### P3 — future
17. Occasion taxonomy pages — highest-ROI SEO work available
18. Arabic OG cards via a real text engine
19. Real product photography
20. `previousSlugs` + redirect infrastructure
21. About page

**One sentence:** the infrastructure is solid — routing, i18n, theme, SEO, schema, legal, data model — but the *content layer* still describes a different product than the one that exists, and still describes one product where it should describe a collection.

---

## 23. Proposed next phase

Nothing touches Studio, checkout, Paddle, the Django API or AR/VR. Four reviewable passes.

**Pass A — truth and naming** *(the P0s; everything else builds on it)*
- Support email → `heartfolioapp@gmail.com`
- Product renaming once §2 is answered: Where We Met, plus whatever you decide on Moon Phase. Includes `id`/`slug` decoupling, `previousSlugs` + redirects, waitlist data note
- Claim audit: I bring the full §10 list with a proposed rewording for each; you approve line by line. Nothing changes without sign-off — these are business commitments, not copy preferences
- Fix the landing pricing section: "From $12 USD", derived, model-explaining (§6)
- Resolve `/create` vs `/products` and repoint every CTA

**Pass B — brand as a collection** *(P1)*
- Debias celestial language in moods, FAQ, pricing features, How It Works
- Rewrite the collection heading (§7); remove hardcoded counts
- One plain definitional line on the homepage (helps §8 and §16)
- Rebalance the hero: non-sky dominant piece, star map demoted to a glimpse
- Fix Gift Occasion CTAs naming unbuilt products
- Homepage FAQPage schema; Organization `sameAs`; seller identity block

**Pass C — presentation quality** *(P1/P2)*
- Move registry reads out of client components (unblocks the API)
- Upgrade offering mockups from CSS rectangles to properly drawn frame/device presentations
- Rework the Love Story Timeline artwork
- Asset brief: the §9 list in priority order, specified precisely enough to commission or generate — starting with real generator outputs, not mockups

**Pass D — responsive and Arabic polish** *(P2)*
- Tablet fixes for the four areas in §21
- Arabic pass on the eight risks in §19, ideally after you've looked at `/ar` on a real device

**Deferred:** occasion taxonomy pages, About page, Arabic OG rendering, real photography commissioning.

**Recommendation: do Pass A alone next and review it** — the naming and claim decisions are yours, and B and C harden around them.
