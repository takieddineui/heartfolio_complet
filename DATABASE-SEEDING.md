# Database Seeding

Two different mechanisms exist, for two different situations — don't
confuse them.

## A fresh, empty database → `seed_catalog.py`

```bash
cd backend
python manage.py migrate
python seed_catalog.py            # creates rows, never touches existing prices
python seed_catalog.py --update-prices   # also overwrites prices that differ from the file
```

This is idempotent (`update_or_create` throughout) and safe to re-run.
**Price protection is deliberate:** by default, if a price in the database
already differs from what's in this file, the seed script reports the
drift and changes nothing, rather than silently overwriting a real price
someone set through the admin. Pass `--update-prices` only when you
actually mean to reset prices to what's in the file.

**This file was found to be badly stale during this handoff and has been
fixed.** It still described the *old* four-pack catalog — standalone
wallpaper active, no combo packs, old prices — the state from before the
pricing/catalog rework, whose SQL was applied by hand to the live database
but never reflected back into this script. A fresh database seeded from
the old version would have silently come up in a state the live database
had already moved past. It's now current — see `PRODUCT-CATALOG.md` for
the exact state it produces, and `tests_seed_catalog.py`'s
`RealCatalogStateTests` (new, added during this fix) for tests that
validate the real `CATALOG` constant directly: exact prices, that the
combo packs' targets are genuinely the union of their two sources (not
hand-typed), and that Complete excludes AR.

Expected output for Love Story Timeline: **6 rows, 5 active, 1
disabled** — see `PRODUCT-CATALOG.md`'s pricing table for the exact list.

Also seeds `Occasion` and `PrintSize` reference tables
(`seed_catalog_entities()`, called from the same script) from values
currently hardcoded in code.

## An existing database that already has the OLD catalog state

This is what actually happened to reach the current live pricing — a
hand-reviewed, hand-run SQL migration, not this script. If you're bringing
an *existing* database (one that still has the old four-pack state) up to
date rather than seeding a fresh one, that SQL is what was used; it is not
included in this file tree as a standalone script since it was run once,
directly, against the live database, with explicit human sign-off at each
step (a `DO $$ ... $$` block with preconditions that aborts loudly if
reality doesn't match assumptions, then the actual `UPDATE`/`INSERT`
statements, then a post-insert proof that the combo packs' targets are an
exact union). If you need to reconstruct it, `PRODUCT-CATALOG.md`'s
pricing table has the exact target state, and `seed_catalog.py`'s
`CATALOG` constant has the exact `included_targets` arrays to match.

## Verifying either path worked

```sql
SELECT slug, price_cents, status
FROM delivery_packs dp
JOIN products p ON p.id = dp.product_id
WHERE p.slug = 'love-story-timeline'
ORDER BY status, slug;
```

Expect exactly the six rows in `PRODUCT-CATALOG.md`'s table.
