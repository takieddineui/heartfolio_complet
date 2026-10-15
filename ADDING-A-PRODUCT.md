# Adding a Product — Checklist

Written after Song Poster shipped a complete renderer, a complete Studio
module, and a real, priced Django catalog — and still didn't show up on
the site. Nothing was broken; a required step was just never done, and
nothing forced anyone to notice.

## The one fact this whole checklist exists to make unmissable

**Django's catalog and the frontend's product registry are two
independent sources of truth. Populating one does not populate the
other, and there is no automated link between them — that gap is
deliberate architecture, not an oversight to fix.**

`lib/products/registry.ts` says so directly, and it is worth repeating
here: a hidden product must behave as if it does not exist, even while
Django still lists it as sellable — that split is exactly what lets an
already-placed order stay downloadable after a product is withdrawn
from sale (`heart-map` is the live example: Django still sells it,
`/orders/<id>` still works, the storefront still refuses to show it).

The SAME mechanism that makes withdrawal safe is what makes forgetting
to flip a NEW product invisible: `seed_catalog.py` succeeding and
printing real prices tells you Django is ready. It tells you nothing
about whether the storefront is.

## The full sequence

### Backend

1. Build the renderer module: `apps/delivery/product_renderers/<slug>/`
   (data validation, PNG composition, tests). The Studio preview (CSS) and
   this print renderer (Pillow) are two separate implementations of one
   design. Read `PRINT-RENDERER-GUIDE.md` first: it covers how to read the
   preview's real values, the bugs Love Story Timeline hit (missing fields,
   wrong size estimates, card overflow, cut text), and the checklist for
   calling a print "done".
2. Register it in `apps/delivery/registry.py`.
3. Add the catalog entry to `seed_catalog.py` — both the product +
   packs in `CATALOG`, and the product's target set in
   `supported_targets()`.
4. Run it for real: `docker compose exec api python seed_catalog.py`
   (add `--update-prices` only when you actually mean to overwrite
   prices already in the database). Read the printed summary — it
   will say `created` or `updated` for the product and every pack, and
   the final `totals:` line will say whether the database now matches
   this file exactly.
   **This step alone does not make the product visible anywhere.**

### Frontend — Studio (the creation tool)

5. Build the Studio product module:
   `lib/studio/product-modules/<slug>/` (schema, initial state,
   validation, pricing, exports, renderer adapter, themes, messages).
6. Register it in `lib/studio/product-modules/registry.ts`.

### Frontend — the storefront (the step that was actually missed)

7. **Edit the product's own entry in `lib/products/registry.ts`:**
   - Remove `hidden: true` (or don't set it at all).
   - Set `status: "available"`.
   - Once Django genuinely owns the commercial data for this product
     (a real renderer + a real catalog, both true at this point), set
     `offerings: []` and let `lib/products/catalog.ts` join in real
     price/pack data from Django at request time — the same pattern
     `love-story-timeline` and `heart-map` already use, and the same
     comment already sitting on both of their entries explains why: a
     hardcoded offerings list here can advertise a price or a pack
     shape the backend can no longer deliver.
8. Add the `Products.<i18nKey>` translation block — name, descriptions,
   `meta`, FAQ — to **every** locale's messages file (`en`, `fr`,
   `ar`), not just `en`. `registry.ts`'s own top comment already states
   this; it is restated here because it is easy to do for one locale
   and forget the other two.
9. Optional, not blocking: a real `ogImage` (1200×630) to replace the
   auto-generated share-card fallback. `registry.ts`'s own bottom
   section lists exactly which path each product still needs.

### Selling it through Freemius (the checkout in use)

A product with no Freemius plan cannot be bought: `stage_freemius_checkout`
raises `FreemiusPlanNotConfigured`. Song Poster is in this state today (its
packs are in `seed_catalog.py` and the FastSpring map only), so it is not a
pattern to copy here; Love Story Timeline's own plans are.

- **Owner:** create a NEW plan in the Freemius dashboard for every pack you
  sell, one price point each, equal to the pack's `price_cents`. Never rename
  or retarget a plan that already has licenses (plan 70518 is Complete
  forever; see CLAUDE.md).
- **Code:** add `"<product-slug>:<pack-slug>": {"plan_id": "<id>"}` to
  `FREEMIUS_PLAN_MAPPING` (`apps/commerce/freemius_integration.py`) with a
  mapping test, as the existing rows have.
- **Owner:** run one sandbox checkout end to end.

### A live-only product (no print, no file)

Reasons I Love You is the first: the customer buys the hosted page and
nothing else. Most of the steps above still apply, with these differences:

- **No print renderer, but still a registry entry.** Step 1 shrinks to
  `data.py` (validation) and a renderer class that only implements
  `validate_project_data` (its `render()` raises). The registry is the one
  place order creation finds a product's pre-payment check; without an entry
  a malformed project is sold and then fails on its live page. See
  `product_renderers/reasons_i_love_you/renderer.py`.
- **One pack, slug `live`, targets `["__live__"]`.** Delivery answers
  `__live__` with the hosted page before any renderer is consulted, and the
  `live` slug is already the Digital pack everywhere (delivery type, checkout
  grouping, Digital-only order screens, gift QR card, receipt email). Add
  `{"__live__"}` to BOTH target maps (`seed_catalog.py`'s `supported_targets`
  and `apps/products/admin.py`'s `_supported_targets`).
- **The live page needs a builder on both sides.** Add the product's payload
  builder to `_LIVE_PAYLOAD_BUILDERS` in `apps/delivery/live_views.py` (a
  product missing from it gets the generic 404, by design) and a branch in
  `app/[locale]/live/[liveId]/page.tsx`. Generate photo URLs fresh in the
  builder (`get_asset_for_customer` + `generate_asset_access_url`); they
  expire after `R2_PRESIGNED_URL_EXPIRY_SECONDS`, so a page that loads photos
  lazily must also be able to ask again (`reasons-live-page.tsx`).
- **The gift QR card's caption.** `_qr_caption_for_order` in
  `apps/delivery/bonuses.py` names the recipient's card per product (Love
  Story Timeline: the couple; Song Poster: the song; Reasons I Love You:
  "Theo & Hana"). The names only, never an English sentence: nothing on that
  card is translated. A product with no branch gets the generic caption.
- **Audio or video?** Register a collector in `_MEDIA_COLLECTORS`
  (`apps/commerce/media_promotion.py`), with a test that a paid order keeps
  its media. Without one, only `events[].video/audio` is read, and anything
  else is deleted by `expire_provisional_assets` a week after purchase. Photos
  never expire and need nothing.
- **The Studio module is `renderer: { kind: "live" }` and
  `delivery: { mode: "hosted", hosted: { description: "<key>" } }`**, with a
  `livePreview` component. `kind: "live"` mounts only that preview, full pane,
  in a box that clips and cannot scroll; there are no Artwork/Framed tabs.
  Keep the experience's own overlays positioned against its own frame, never
  the window, or they cover the whole Studio.
- **A long, scrolling experience** (Graduation Keepsake, not a single screen
  like Reasons): the page scrolls inside the frame's OWN scroller, every
  overlay is `position: absolute` against the frame, and sizes use container
  units (`container-type: size` on the frame, then `cqw`/`cqh`), because
  `vw`/`svh` measure the window, which in the Studio is not the pane. Write
  nothing to `<html>` or `<body>` (no journey attribute, no scroll lock, no
  theme colour). See `components/live-graduation/graduation-keepsake.module.css`.
- **Count the uploads.** Production allows `asset_upload` 30 a minute, and
  the Studio uploads every file at checkout at once. Cap a product's
  worst case below that with room for a retry (Graduation Keepsake: 25, by
  capping voice messages and drawings at 5 each per keepsake), and pin the
  sum in a test.
- **Fields that belong to one choice** (a journey, a gift): hide them with
  `visibleWhen` on the theme, or a whole section with the section's own
  `visibleWhen`; the form engine then skips them. Rules in the module's
  `validate(values, themeSelections)` and in `data.py` must skip them too, or
  a value left over from trying another choice blocks payment invisibly.

### Verify it actually happened — don't trust step 4 alone

10. Confirm the product is genuinely visible, not just genuinely
    seeded. The fastest real check:
    ```ts
    import { getAllProducts } from "@/lib/products/registry";
    console.log(getAllProducts().map((p) => p.slug));
    ```
    or run the existing test suite — `lib/products/catalog.test.ts`'s
    own "withdrawn products" tests assert the full visible list by
    name, so a newly-added product that was meant to be visible but
    isn't will fail a real, already-existing test, not fail silently.
    (This is exactly how the Song Poster gap was found after the fact
    — checking the site and noticing only one product rendered. The
    point of this step is to do that check as part of launching, not
    as debugging afterward.)

## If a product should stay hidden a while longer

That's what `hidden: true` is *for*. Steps 1–6 can happen well before
steps 7–9; building the product and deciding to sell it are two
different moments, and the registry is what lets those be separate
deliberately rather than by accident.

## If a product needs to stop being sold, or be removed entirely

Two different operations, worth not confusing:

- **Withdrawn, but orders already placed must stay downloadable**
  (the `heart-map` pattern): set the product's `status` to `"disabled"`
  in `seed_catalog.py` (or disable its individual packs), set
  `hidden: true` in `registry.ts`, run `seed_catalog.py` again. Nothing
  is deleted. Fully reversible.
- **Genuinely deleted, never sold at all** (the Star Map pattern): only
  safe when NO backend `Product`/`DeliveryPack` row was ever created
  for it — `DeliveryPack`, `Order`, and `Entitlement` all point at
  `Product` with `on_delete=RESTRICT`, so the database itself refuses
  to delete a product that any real order has ever touched. If a
  product has real orders against it, "delete" is not an option at
  all — use the withdrawal pattern above instead, permanently if
  necessary.
