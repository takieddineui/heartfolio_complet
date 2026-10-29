# Adding, changing or withdrawing a product: checklists

Rewritten 27 Oct 2026 to cover everything a product now touches: the
storefront captures, the SEO limits, combos and Freemius plans, the guides,
and the live pages' languages. **Follow it whenever a product is added,
changed or withdrawn.** Where a step can be checked automatically, the test
that checks it is named; `frontend-heartfolio/src/lib/products/product-checklist.test.ts`
names every visible and withdrawn product against the checkable steps in
one place.

## The one fact this whole checklist exists to make unmissable

**Django's catalog and the frontend's product registry are two independent
sources of truth.** Populating one does not populate the other, and that gap
is deliberate: a hidden product must behave as if it does not exist on the
storefront while Django keeps every past order working (Where We Met,
`heart-map`, is the live example). The same split is what makes a forgotten
step invisible: `seed_catalog.py` printing real prices tells you Django is
ready, and nothing about the storefront. Song Poster once shipped a complete
renderer, Studio module and priced catalog, and still did not appear on the
site.

Two more rules apply throughout:
- **Real-database writes are the owner's.** The seed (`seed_catalog.py`) and
  any checkout against Supabase are run by the owner; tests and recordings use
  the throwaway database (CLAUDE.md).
- **Run the guard rows** (CLAUDE.md, "Running the tests") for every kind of
  file the step touched, not only the tests beside it.

---

## 1. Adding a product

### A. Backend: catalog, rendering, payment

1. **Rendering.** A product with a print: build
   `apps/delivery/product_renderers/<slug>/` (data validation, PNG
   composition, tests). The Studio preview (CSS) and the print (Pillow) are
   two implementations of one design: read `PRINT-RENDERER-GUIDE.md` first.
   A **live-only** product (no print; Reasons I Love You, Graduation
   Keepsake) still needs `data.py` and a renderer class implementing only
   `validate_project_data` (its `render()` raises): the registry is where
   order creation finds the pre-payment check. Register either in
   `apps/delivery/registry.py`.
2. **Packs in `seed_catalog.py`.** The product and its packs in `CATALOG`,
   and its targets in `supported_targets()` AND in
   `apps/products/admin.py`'s `_supported_targets` (they must agree:
   `CatalogTargetMapParityTests`). The pack model is **combos, not a
   bundle**: each base unit (Printable, Digital = slug `live`) is a pack, and
   each combination you choose to sell (`printable-plus-digital`) is its own
   pack with its own price. A live-only product has one pack, `live`, targets
   `["__live__"]`.
3. **Freemius: every ACTIVE pack needs a plan.** The owner creates one NEW
   plan per active pack in the Freemius dashboard (one-off, one price point,
   equal to the pack's `price_cents`), under the ONE existing Freemius product
   (never a second product: its webhooks would fail the signature check).
   Map each as `"<product>:<pack>": {"plan_id": "<id>"}` in
   `FREEMIUS_PLAN_MAPPING` (`apps/commerce/freemius_integration.py`) and pin
   it in `FreemiusPlanMappingTests`. Never rename or retarget a plan that has
   licences: create a new one (plan 70518 is Complete forever). Checked:
   `SellableMeansMappedTests` (backend) and `product-checklist.test.ts`.
4. **The live page, if it sells the Digital version.** A payload builder in
   `_LIVE_PAYLOAD_BUILDERS` (`apps/delivery/live_views.py`; a product missing
   from it gets the generic 404). Generate photo URLs fresh in the builder;
   they expire, so a page that loads photos lazily must be able to ask again.
5. **Media.** Audio or video anywhere other than Love Story Timeline's
   `events[]`: register a collector in `_MEDIA_COLLECTORS`
   (`apps/commerce/media_promotion.py`) with a test that a paid order keeps
   it, or `expire_provisional_assets` deletes it a week after purchase.
   Photos never expire. Count the uploads against production's
   `asset_upload` 30 a minute and pin the worst case in a test.
   **Uploads need nothing else (27 Oct 2026):** the Studio sends the product
   with each upload and the server stores it as
   `uploads/<product>/<asset id>.<ext>` (`generate_storage_key`). Never put a
   customer's filename into a storage key, a log line, an alert or saved
   project data: project saves strip `filename` from every media value
   (`apps/assets/filenames.py`), and nothing on the server may need it.
6. **What the customer receives.** The gift QR card's caption
   (`_qr_caption_for_order`, `apps/delivery/bonuses.py`: names only, never an
   English sentence), the product's name in the receipt email and the bonus
   PDFs in en/fr/ar (`apps/commerce/email_copy.py`,
   `apps/delivery/bonus_copy.py`; `email-product-names.test.ts`).
   **Branding (owner, 27 Oct 2026): every deliverable carries the colophon
   "Heartfolio · theheartfolio.com"** (`apps/delivery/attribution.py`), never
   translated, no slogan, no logo. A print or wallpaper draws it LAST through
   `draw_colophon`, in the bottom corner the product's designs keep empty, in
   the product's muted colour at `MARK_OPACITY` and `MARK_SCALE`, at least
   `FRAMELESS_SAFE_PX` (6.35mm) from the trim of a frameless print and inside
   the border of an edged one, and never over the customer's photos or words:
   add the product to `apps/delivery/tests_colophon.py` (every layout or theme,
   every print target, Latin and Arabic at maximum content). The QR cards, the
   bonus PDFs, the receipt email and the share cards are shared and need
   nothing.
7. **The owner runs the real seed** (`docker compose exec api python
   seed_catalog.py`) and reads its summary. This alone makes nothing visible.

### B. The Studio

8. Build `lib/studio/product-modules/<slug>/` (schema, initial state,
   validation, exports, renderer adapter, themes, messages) and register it
   in `lib/studio/product-modules/registry.ts` (checked:
   `product-checklist.test.ts`). A live-only product is
   `renderer: { kind: "live" }`, `delivery: { mode: "hosted" }`, with a
   `livePreview`; a long scrolling experience scrolls inside its own frame,
   sized in container units (see Graduation Keepsake's CSS).
9. **Labels in en/fr/ar:** every seeded pack's name and description
   (`pack-labels.test.ts` reads the slugs from the seed), the print and
   wallpaper export labels (`lib/studio/export-labels.ts`,
   `export-labels.test.ts`), the Appearance options.
10. **Limits** named once in `limits.ts` and the backend `data.py`, pinned
    equal by a test (`reasons-module.test.ts` is the pattern).
11. **The Studio's sample in en/fr/ar** (`initial-state.ts`): it is also what
    the storefront captures record, so use culturally fitting fictional
    names, never real people.

### C. The storefront

12. **Registry entry** (`lib/products/registry.ts`): `id` (permanent: it keys
    the captures and waitlist rows), `slug`, `i18nKey`, `status: "available"`,
    no `hidden`, `offerings: []` (Django owns prices), `ogImage: null` (the
    card is generated), `featured` if it belongs on the home page, and
    `tags`: its occasions (they drive the occasion filters and related
    products) and **`printable` exactly when it sells an active Printable
    pack** (the printable-gifts page lists by it; `gift-intents.test.ts` and
    `product-checklist.test.ts` compare it with the seed).
13. **Copy in en/fr/ar** (`messages/*.json`, `Products.<i18nKey>`): name,
    short and full descriptions, `meta.title`, `meta.description` and
    `meta.descriptionNoPrice`, the FAQ, offering names. **SEO limits:** the
    rendered title (with " — Heartfolio") at most 60 characters, so
    `meta.title` at most 47; each description at most 160 with a price filled
    in, and never a price written into the copy (`seo-lengths.test.ts`,
    `messages.test.ts`). English and French are shown to the owner before
    translating; Arabic is translated, then reviewed when a native reviewer
    is available.
14. **The live page in the order's language.** Add the product's branch to
    `components/live/live-payload.tsx` (the dispatch the live page and the
    capture page share; checked: `product-checklist.test.ts`). Every word
    the page writes comes from a copy module chosen by the order's locale
    (`live-copy.ts`, `player-copy.ts` are the pattern), never an English
    literal. Dates and counts use `Intl` in the order's language, dates as
    calendar days in UTC (`locale-format-parity.test.ts`; the "3y 4m 22d"
    and west-of-UTC bugs). Right to left: mirror the layout on /ar unless the
    thing is directional by nature (Song Poster's soundwave and times stay
    left to right).
15. **Fonts that cover French and Arabic.** Every face the product uses must
    hold every French letter (Gaegu held only ASCII: "faÇon") and either
    Arabic or a fallback to the site's Kufi/Naskh; self-hosted, with its
    licence beside it. Pin it with a character-map test
    (`test/font-cmap.ts`, `reasons-fonts.test.ts` is the pattern) and run
    the fonts guard row.
16. **Captures in all three languages** (`scripts/captures/record.mjs`; how,
    in CLAUDE.md). Add the product to `PRODUCTS` (and `PRINTABLE` if it sells
    a print), write its `SCENARIOS` entry (what the loop shows), add licensed
    photos to `backend/apps/delivery/marketing_samples/` with their source in
    `PHOTOS.md`, then run the stages (`samples`, `bundle`, `record`,
    `stills`) against the throwaway database. `captures.test.ts` fails for a
    visible product without them, or over budget; look at the contact sheet
    before using them.
17. **Share image and Product structured data come from the captures** (the
    product page's `opengraph-image`, with its alt text per language; the
    Product JSON-LD's images, offers and the `/refunds` return link): nothing
    to write, but check them in the crawl (step 23).
18. **Sitemap and hreflang** follow `getAllProducts()` by themselves; add the
    product page's content date to `CONTENT_UPDATED` in `app/sitemap.ts`
    (`seo-status.test.ts` fails without it).
19. **Home page:** `featured` puts it in the hero's phone and the collection;
    add it to the right card in "By occasion"
    (`components/sections/by-occasion.tsx`, `OCCASIONS`); the gift pages
    (`/gifts/<slug>`) pick it up by tag; the footer, `llms.txt` and the
    merchant feed follow the catalog.
20. **Guides.** Decide which existing guides should link to it: add it to
    the guide's `products` and a `product` block in EVERY translation (and
    move the guide's `updated` date). If none fits, put it in
    `GUIDE_COVERAGE_PENDING` (`lib/guides/coverage.ts`) with the reason, and
    ask the owner whether it needs its own guide.
    `product-checklist.test.ts` fails for a product in neither; the product
    page's "Ideas and guides" section then appears by itself.

### D. Verify

21. **Tests:** the new tests; `product-checklist.test.ts`; the guard rows for
    copy, fonts, captures, live pages, seed/packs, page metadata and, for a
    print, preview/print parity; then the full frontend suite (a product is
    shared infrastructure) and the backend labels named above.
22. **Browser:** the product page, its Studio and its live page at 1280 and
    375 px in en/fr/ar: no sideways scroll, right to left correct, nothing in
    English on /fr or /ar.
23. **Crawl the production image** (titles, descriptions, canonical,
    hreflang, share image, structured data), as done for the SEO work.
24. **Owner:** the real seed run, then one sandbox checkout end to end.

---

## 2. Changing a product

- **A price:** the seed (`--update-prices` when meant) AND a NEW Freemius
  plan at the new price, remapped; never edit a plan that has licences.
  Check `meta.description` still fits 160 with the new price.
- **A pack or combo:** step 2, step 3 (a plan per new active pack), step 9
  (its labels), and the checkout's unit toggle appears by itself for a combo.
- **Copy:** step 13's limits; move `CONTENT_UPDATED` for the product page,
  and a guide's `updated` if its text changes.
- **Anything a customer sees on the live page or in the Studio sample:**
  re-record the captures (step 16); a visible change without it ships stale
  marketing.
- **A print layout:** `PRINT-RENDERER-GUIDE.md` and the parity guard row.

---

## 3. Withdrawing or deleting a product

### Never delete these

- **Past orders and everything they point at:** the `Product` and
  `DeliveryPack` rows (`Order`, `Entitlement` and `DeliveryPack` reference
  `Product` with `on_delete=RESTRICT`: the database refuses anyway), the
  orders, entitlements and uploaded photos (photos never expire).
- **What re-creates their files:** the backend renderer and its fonts. Files
  are rendered on demand, so a past order downloads only while its renderer
  exists.
- **Live pages customers already received:** `/live/<id>` must keep working,
  so keep the product's `_LIVE_PAYLOAD_BUILDERS` entry, its branch in
  `live-payload.tsx`, the live component, its fonts and its copy.
- **Uploads under the `uploads/<product>/` folder of a withdrawn product:**
  past orders still read them through `Asset.storage_key`. The folder name
  is only a location; nothing reads it.
- **Freemius plans with licences, and their mapping:** remove a product's
  mapping only if it never had an order (the owner checks; Complete's 70518
  stays mapped although the pack is disabled).

### Withdrawing (orders already placed keep working)

1. **Registry:** `hidden: true` (and `featured: false`). The proxy then
   answers 404 for its product page and Studio, and every list built from
   `getAllProducts()` drops it: collection, home, footer, gift pages,
   sitemap, `llms.txt`, merchant feed.
2. **Seed:** set the product's `status` to `"disabled"` and EVERY pack's to
   `"disabled"`, never delete them; the owner runs the seed. Checked:
   `product-checklist.test.ts` (a withdrawn product has no active pack) and
   `SellableMeansMappedTests`.
3. **Freemius:** keep the mapping if it has any order (see above).
4. **Captures:** remove it from `record.mjs` (`PRODUCTS`, `PRINTABLE`,
   `SCENARIOS`), delete its files from `public/captures/<locale>/`, and
   rewrite the manifest (`record.mjs stills`). `captures.test.ts` fails on a
   stray file; `product-checklist.test.ts` on a withdrawn product still
   recorded.
5. **Guides:** remove it from every guide's `products` and its `product`
   blocks in every translation, rewrite the sections that relied on it, move
   their `updated`; drop it from `GUIDE_COVERAGE_PENDING`. Checked:
   `guides.test.ts` (no hidden product in a guide).
6. **Pages that name it by hand:** "By occasion" (`OCCASIONS`), the home
   sections that use one product's capture (`how-it-works.tsx`'s
   `QR_PRODUCT`, `open-moment.tsx`'s `PRODUCT`; both Love Story Timeline
   today), its `CONTENT_UPDATED` entry in the sitemap, and any copy that
   mentions it (the home FAQ's "Which keepsake should I choose?", the
   "What is Heartfolio?" answer).
7. **Check:** the sitemap, the merchant feed, the printable gifts page, the
   home page and the collection no longer show it, on the production image;
   and that a past order's page and live page still open.

### Deleting entirely (never sold at all)

Only when NO backend `Product`/`DeliveryPack` row was ever created for it
(the Star Map pattern): remove the registry entry, the Studio module, the
renderer, its messages and its captures. If a product has ever had an order,
deleting is not an option: withdraw it, permanently if need be.

### Keeping a product hidden a while longer

That is what `hidden: true` is for: section A and B can happen well before
C. Building a product and deciding to sell it are two moments.
