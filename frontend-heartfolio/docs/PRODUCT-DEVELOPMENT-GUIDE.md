# Adding a New Product

The system is designed so a new product needs **no Shell changes, no
backend code and no migrations**. If you find yourself editing
`StudioShell`, the module loader or `apps/commerce`, stop — the design is
being worked around.

## Stage 1 — Standalone prototype (`new-product.html`)

Validate before writing any React: visual design at final size; which fields
are actually personalizable; layout at every format you intend to sell
(print, story, square, portrait, landscape); responsive behaviour; how it
renders at print resolution; which packs make commercial sense; typography
at small and large sizes; imagery/photo placement; and print quality at
300 dpi.

Get this right first. Everything downstream encodes these decisions.

## Stage 2 — Product specification

Write down, before coding:

- **slug** (public URL) and **id** (stable, used by Django and the module
  registry). Keep them identical unless you have a reason — Where We Met is
  the one exception, and it exists only because the public slug changed
  after launch.
- name / description i18n keys, category (must be one of the DB's allowed
  values), tags
- personalization fields → the `formSchema`
- theme axes → `themes`
- render targets the renderer will genuinely support
- packs, their targets and prices
- assets required (photos? coordinates? dates?)

## Stage 3 — Frontend integration

| File | Change |
|---|---|
| `lib/products/registry.ts` | Add the `ProductEntry`. **`offerings: []`** — prices come from Django |
| `lib/studio/product-modules/<id>/` | New module: `schema.ts`, `themes.ts`, `renderer.tsx`, `renderer.module.css`, `messages.ts`, `exports.ts`, `initial-state.ts`, `index.ts` |
| `lib/studio/product-modules/registry.ts` | Register the loader **by stable id** |
| `src/messages/{en,fr,ar}.json` | `Products.<i18nKey>` — name, descriptions, meta, story, FAQ |
| module `messages` | Field labels, theme labels, `packs.*.name` / `.description` |
| `public/` | Artwork if any (optional — OG cards generate automatically) |

Routes, SEO metadata, sitemap entries and OG images are **automatic**: the
sitemap reads the registry and `/products/[slug]` is a dynamic route. No
route registration is needed.

Indexability: product pages are public and indexed by default.

## Stage 4 — Backend integration

**No migrations.** No code. Add rows through Django admin:

1. `Product` — slug (the stable id), `name_i18n_key`, category, status
   `available`, `starting_price_cents`, order, tags
2. `DeliveryPack` × N — slug, i18n keys, `price_cents`, currency,
   `included_targets`

A migration is only appropriate if you are changing the *schema* — a new
column or constraint. Adding a product never is.

## Stage 5 — Delivery

1. Write `apps/delivery/product_renderers/<product>/` with a `renderer.py`
   exposing `render(project, delivery_type, delivery_pack, target_id)` and a
   `TARGET_DIMENSIONS` map.
2. Register it in `apps/delivery/registry.py`.
3. Read input photos through the ownership-checked asset service; never
   fetch R2 directly.
4. Return `TemporaryFileResult` (bytes) — those are archivable into the pack
   ZIP. A URL result is excluded from the ZIP by design.

The products admin validates `included_targets` against the renderer, so a
target the renderer can't produce cannot be saved.

## Stage 6 — Testing

Frontend: module loads, schema renders, preview draws, validation fires,
EN/FR/AR + RTL. Backend: renderer unit tests per target, catalog API,
order creation, entitlement grant, download authorization (unpaid → 404,
other guest → 403), ZIP contents. Then `tsc`, `eslint`, `vitest`,
`next build`, `manage.py test`.

## Stage 7 — Activation

```
HTML prototype
  → Product Module + registry entry      (visible in Studio, not sellable)
  → renderer + registry                  (deliverable, still not sellable)
  → Django Product row, status=available (appears in catalog)
  → DeliveryPack rows                    ← THIS makes it purchasable
  → live purchase test
```

**The `DeliveryPack` rows are what make a product purchasable.** A product
with no active packs shows no offerings and cannot be ordered. That is also
how you take a product off sale without a deploy: set `status=disabled`, or
disable its packs.
