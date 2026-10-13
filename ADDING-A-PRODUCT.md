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

## A LIVE-ONLY product (Graduation Keepsake is the precedent)

Love Story Timeline and Song Poster both have print targets. A product whose
only deliverable is the hosted page (`__live__`) skips step 1's Pillow work and
needs these instead - found by building Graduation Keepsake, and each one
would have been a silent failure:

- **Renderer.** `render()` has nothing to do (delivery short-circuits
  `__live__` to the live URL) so it refuses every target loudly; what matters
  is `validate_project_data`, `create_order`'s pre-payment gate. Its
  `data.py` is the one place that interprets `values`.
- **Live payload: register a builder.** `live_views.py` dispatches through
  `_LIVE_PAYLOAD_BUILDERS` (product slug -> builder). Before this it fell
  through to Love Story Timeline's builder for any product it did not name, so
  a new product's live page was a silent 404. An unknown product now logs
  `live_experience_product_has_no_payload_builder`. Add your product to the
  registry, build a payload from the SAME `values` shape the Studio produces
  (so the Studio's Live tab and the purchased page are one component), and
  generate every media URL fresh per request, in one query.
- **Media promotion: register a collector.** `apps/commerce/media_promotion.py`
  decides which audio/video a PAID order keeps. It used to read only Love Story
  Timeline's `events[].video/audio` for every product, so a new product's voice
  or video would be deleted by `expire_provisional_assets` a week after
  purchase, with the order paid and nothing logged. Add the product to
  `_COLLECTORS`, and test it (a paid order keeps its audio; an unpaid one
  expires). Photos are never provisional and need nothing.
- **Gift card title.** `_qr_caption_for_order` in `bonuses.py` has a per-slug
  branch that names the recipient's QR card. Without one the card is nameless.
- **Both `supported_targets` maps.** `seed_catalog.py` and
  `apps/products/admin.py` each hardcode a product's targets. For a live-only
  product it is `{"__live__"}`. `admin.py` returned `None` (validate nothing)
  for a product it did not list - Song Poster was missing - so a bad pack saved
  unchecked.
- **Category.** `Product.category` is guarded by a CHECK constraint
  (`ck_products_category_valid`); a new value is a migration, which is run by
  hand. Use `other` unless the category drives UI.
- **Studio shell.** `ProductModuleConfig.previewModes` (`["live"]`) makes the
  Live tab the only preview and hides the tab strip; `delivery.mode:
  "interactive"` with a `descriptionKey` replaces the export list. Both are
  config, never a product id in the Shell.
- **Seed status.** Seed the Django row as `coming_soon` (not `available`) when
  there is no Freemius plan yet, so nothing can be ordered that cannot be paid
  for; flip it with the un-hide.
- **Freemius.** One plan per pack, mapped as `"product:pack"` in
  `FREEMIUS_PLAN_MAPPING`. Do not invent an id: `stage_freemius_checkout`
  raises `FreemiusPlanNotConfigured` until the plan exists, which is the right
  failure for a hidden product.

### Fonts for a product with its own look

Fonts are self-hosted woff2 in `public/fonts` with their OFL text beside them,
never a Google Fonts link. Declare a journey's `@font-face` rules in its OWN
CSS module, loaded with the journey's lazy chunk, so a visitor downloads only
the faces of the experience they were sent (and the browser fetches a face only
when a glyph needs it). `live-graduation/hygiene.test.ts` pins this.

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
