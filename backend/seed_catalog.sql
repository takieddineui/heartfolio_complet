-- Heartfolio — launch catalog seed (raw SQL version)
--
-- Run with psql, or any SQL client, against the target Postgres. (This used
-- to say to paste it into Railway's Postgres query tab; Railway is no longer
-- used.)
--
-- STALE, AND DANGEROUS TO RUN AS-IS: this file still describes the old
-- four-pack Love Story Timeline catalog and its old prices — it predates the
-- five-tier structure and the Printable + Digital combo. Its ON CONFLICT ...
-- DO UPDATE would write those old prices over the live ones. Use
-- `seed_catalog.py` instead, which protects existing prices by default.
--
-- Idempotent: uses ON CONFLICT ... DO UPDATE, so running it again (e.g.
-- after a price change) updates the existing rows instead of erroring or
-- duplicating them.
--
-- IMPORTANT — this bypasses the Django admin's own validation, which
-- checks `included_targets` against each product's registered renderer.
-- A bad target here would save fine, sell fine, and only fail at
-- download, after a customer has paid. The values below have already
-- been validated that way (see the Python version of this script) — do
-- not add a target that isn't listed as supported in the comments.
--
-- Slugs: Where We Met is published at /products/where-we-met but its
-- database slug is `heart-map` — that is intentional, not a typo. Do not
-- change it to where-we-met.

BEGIN;

-- ---------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------

INSERT INTO products
    (id, slug, name_i18n_key, category, status, starting_price_cents, "order", tags, created_at, updated_at)
VALUES
    (gen_random_uuid(), 'love-story-timeline', 'loveStoryTimeline', 'timeline', 'available', 800, 4,
     '["timeline", "anniversary", "wedding", "photos"]'::jsonb, now(), now()),
    (gen_random_uuid(), 'heart-map', 'whereWeMet', 'map', 'available', 800, 3,
     '["map", "anniversary", "wedding"]'::jsonb, now(), now())
ON CONFLICT (slug) DO UPDATE SET
    name_i18n_key        = EXCLUDED.name_i18n_key,
    category              = EXCLUDED.category,
    status                = EXCLUDED.status,
    starting_price_cents  = EXCLUDED.starting_price_cents,
    "order"               = EXCLUDED."order",
    tags                  = EXCLUDED.tags,
    updated_at            = now();

-- ---------------------------------------------------------------------
-- Delivery packs
--
-- Prices are in CENTS: 1800 = $18.00.
--
-- love-story-timeline renderer supports:
--   print-png, story-png, square-png, landscape-png, portrait-png, __live__
-- heart-map renderer supports (no digital renderer — no __live__, no landscape-png):
--   print-png, story-png, square-png, portrait-png
-- ---------------------------------------------------------------------

-- Love Story Timeline — 4 packs
INSERT INTO delivery_packs
    (id, product_id, slug, name_i18n_key, description_i18n_key, price_cents, currency, included_targets, status, created_at, updated_at)
SELECT gen_random_uuid(), p.id, v.slug, v.name_key, v.desc_key, v.price_cents, 'USD', v.targets::jsonb, 'active', now(), now()
FROM products p
JOIN (VALUES
    ('printable', 'packs.printable.name', 'packs.printable.description', 1800,
        '["print-png"]'),
    ('wallpaper', 'packs.wallpaper.name', 'packs.wallpaper.description', 800,
        '["story-png", "landscape-png"]'),
    ('live',      'packs.live.name',      'packs.live.description',      1200,
        '["__live__"]'),
    ('complete',  'packs.complete.name',  'packs.complete.description',  3000,
        '["story-png", "square-png", "landscape-png", "portrait-png", "print-png", "__live__"]')
) AS v(slug, name_key, desc_key, price_cents, targets)
    ON true
WHERE p.slug = 'love-story-timeline'
ON CONFLICT (product_id, slug) DO UPDATE SET
    name_i18n_key        = EXCLUDED.name_i18n_key,
    description_i18n_key = EXCLUDED.description_i18n_key,
    price_cents           = EXCLUDED.price_cents,
    currency               = EXCLUDED.currency,
    included_targets       = EXCLUDED.included_targets,
    status                 = 'active',
    updated_at             = now();

-- Where We Met Map — 3 packs
INSERT INTO delivery_packs
    (id, product_id, slug, name_i18n_key, description_i18n_key, price_cents, currency, included_targets, status, created_at, updated_at)
SELECT gen_random_uuid(), p.id, v.slug, v.name_key, v.desc_key, v.price_cents, 'USD', v.targets::jsonb, 'active', now(), now()
FROM products p
JOIN (VALUES
    ('printable', 'packs.printable.name', 'packs.printable.description', 1800,
        '["print-png"]'),
    ('wallpaper', 'packs.wallpaper.name', 'packs.wallpaper.description', 800,
        '["story-png", "portrait-png"]'),
    ('complete',  'packs.complete.name',  'packs.complete.description',  2400,
        '["story-png", "square-png", "portrait-png", "print-png"]')
) AS v(slug, name_key, desc_key, price_cents, targets)
    ON true
WHERE p.slug = 'heart-map'
ON CONFLICT (product_id, slug) DO UPDATE SET
    name_i18n_key        = EXCLUDED.name_i18n_key,
    description_i18n_key = EXCLUDED.description_i18n_key,
    price_cents           = EXCLUDED.price_cents,
    currency               = EXCLUDED.currency,
    included_targets       = EXCLUDED.included_targets,
    status                 = 'active',
    updated_at             = now();

COMMIT;

-- ---------------------------------------------------------------------
-- Verification — run after the above commits
-- ---------------------------------------------------------------------

SELECT
    p.slug,
    p.status,
    p.starting_price_cents / 100.0 AS starting_price,
    dp.slug AS pack,
    dp.price_cents / 100.0 AS pack_price,
    dp.included_targets
FROM products p
JOIN delivery_packs dp ON dp.product_id = p.id
ORDER BY p.slug, dp.slug;

-- Expected: 7 rows total (4 for love-story-timeline, 3 for heart-map).
