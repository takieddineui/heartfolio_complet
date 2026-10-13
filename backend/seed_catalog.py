"""
Heartfolio — launch catalog seed.

Run once against a fresh production database, from inside the api container
(the repo is bind-mounted at /app, so this is the file you are editing):

    docker compose exec api python seed_catalog.py

WHICH DATABASE THAT WRITES TO: whatever DATABASE_URL the container holds. With
the repo's real `.env.docker` that is the real (Supabase) database, so treat it
as a production write and confirm before running. To rehearse on the throwaway
Postgres instead (migrated first), override it:

    docker compose exec -e DATABASE_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio api python seed_catalog.py

Production is planned as a VPS running this same Docker setup; the same
command applies there. Railway, which this used to say to run it through
(`railway run`), is no longer used.

Idempotent: safe to run repeatedly. Existing rows are updated in place.

PRICES ARE NOT WRITTEN ON A RE-RUN (§5)
---------------------------------------
This script used to overwrite `price_cents` every time it ran, and its own
docstring called that "a legitimate way to apply a price change". That
bundled two unrelated reasons to run it: fixing a pack's included targets,
and setting a price. Once real prices are set in the database — which is
where they live, and where they are decided — anyone re-running this to fix
a target list would silently revert them at the same time, with no warning
and no obvious connection between the action and the damage.

So on an EXISTING pack or product, prices are left exactly as they are, and
any difference is reported rather than applied. On a NEWLY created row there
is nothing to protect, so the figure below is used as an initial value.

To deliberately push the prices in this file into the database:

    python seed_catalog.py --update-prices

That flag exists so changing a price is an explicit act. The numbers in this
file are a starting point for a fresh database, not the source of truth.

WHY THIS VALIDATES TARGETS
--------------------------
The Django admin form checks `included_targets` against the product's
registered renderer. A script bypasses that form, so the same check is
repeated here. It matters: a bad target id saves fine, sells fine and
charges fine — and then fails at download, after the customer has paid.

This script creates DATA ONLY. It adds no migration, touches no schema,
and imports nothing from the application beyond the two catalog models
and the delivery registry it validates against.
"""

import os
import sys

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")
django.setup()

from django.db import transaction  # noqa: E402

from apps.products.models import DeliveryPack, Product  # noqa: E402

from seed_price_policy import price_defaults  # noqa: E402


# ---------------------------------------------------------------------
# The catalog. Prices are in CENTS: 1800 == $18.00
#
# These are INITIAL values for a fresh database only — see the note above.
# The live price of anything is whatever `DeliveryPack.price_cents` holds.
#
# NOTE ON SLUGS: Where We Met is published at /products/where-we-met but
# its database slug is `heart-map`. That is deliberate — the renderer,
# the Studio product module and this row all key off `heart-map`.
# Entering `where-we-met` here would create a product whose renderer
# does not exist.
# ---------------------------------------------------------------------
from apps.delivery.print_sizes import all_print_target_ids
from apps.delivery.wallpaper_devices import all_wallpaper_target_ids

CATALOG = [
    {
        "slug": "love-story-timeline",
        "name_i18n_key": "loveStoryTimeline",
        "category": "timeline",
        "status": "available",
        # $15.99 — the real cheapest active pack (`live`, "Digital"),
        # matching the same fix already applied to Song Poster's
        # starting price. This one was left stale at $10.99 (its old
        # `live` price) when the five-tier FastSpring repricing landed,
        # since it wasn't in that change's explicit scope — closed now.
        "starting_price_cents": 1599,
        "order": 4,
        "tags": ["timeline", "anniversary", "wedding", "photos"],
        # Each tuple is (slug, price_cents, included_targets, status).
        #
        # THE COMBO MODEL. A customer buys base units — Printable, Digital —
        # singly or together, and each purchasable combination is its OWN
        # pack with its own price (and its own Freemius plan), because
        # `Order.delivery_pack` is a single foreign key: an order for a
        # combination is an order for the pack that IS that combination.
        # `printable-plus-digital` below is the first such pack. Its targets
        # are the real union of the two base packs' targets, not hand-typed
        # (pinned by a test in tests_seed_catalog.py).
        #
        # `complete` is RETIRED by that model — disabled, not deleted. Past
        # orders still point at it (`Order.delivery_pack` is RESTRICT) and
        # delivery never checks a pack's status, so existing purchases keep
        # downloading. `apps.commerce.services.create_order` and
        # `stage_freemius_checkout` refuse a disabled pack at the point of
        # purchase regardless of how the request arrives, so a stale
        # bookmark or a direct API call cannot buy it either.
        #
        # SEED ORDER MATTERS: do not run this until `printable-plus-digital`
        # has an entry in `FREEMIUS_PLAN_MAPPING`
        # (apps/commerce/freemius_integration.py). Seeded earlier, the pack
        # would be listed and fail at the staging step with
        # `FreemiusPlanNotConfigured`.
        #
        # `wallpaper` is DISABLED, not deleted: `apps.commerce.services
        # .create_order` refuses a disabled pack at the point of purchase
        # regardless of how the request arrives (the storefront never
        # lists it, but a stale bookmark or a direct API call gets the
        # same refusal) — see that function and its tests. Keeping the row
        # is a deliberate historical record, not an oversight.
        "packs": [
            # §2/§3 — three print sizes, each in both mounting variants.
            # Built from `all_print_target_ids()` rather than hand-listed
            # so a pack cannot end up with a frameless file and no edged
            # one.
            ("printable", 2299, all_print_target_ids(), "active"),
            # Combo packs: included_targets is the real union of their two
            # source packs' own targets, not hand-typed — see the archived
            # migration SQL for the exact jsonb_agg query this mirrors.
            (
                "printable-plus-wallpaper",
                2799,
                [*all_print_target_ids(), *all_wallpaper_target_ids()],
                "active",
            ),
            # Displays as "Digital" to customers (see the Love Story
            # Timeline module's messages.ts) — the DB slug stayed "live" on
            # purpose so `delivery_types.py`'s target-to-pack mapping and
            # every renderer/test keyed on it never needed touching for a
            # copy change.
            ("live", 1599, ["__live__"], "active"),
            # Printable + Digital — the first combo. $35.99 is the two base
            # prices ($22.99 + $15.99 = $38.98) less a flat discount, rounded
            # to a clean price point; a flat amount rather than a percentage
            # by decision. Slug named for the customer-facing labels, like
            # `digital-plus-wallpaper`, not `printable-plus-live`.
            (
                "printable-plus-digital",
                3599,
                [*all_print_target_ids(), "__live__"],
                "active",
            ),
            ("digital-plus-wallpaper", 2099, ["__live__", *all_wallpaper_target_ids()], "active"),
            # RETIRED — see the combo-model note above. Price and targets are
            # historical, unchanged from when it was the active row: they
            # still describe what existing orders were sold. Nobody can buy it.
            (
                "complete",
                3999,
                [*all_print_target_ids(), *all_wallpaper_target_ids(), "__live__"],
                "disabled",
            ),
            # Retired as a standalone purchase — see the DISABLED note
            # above. Price and targets are historical, unchanged from when
            # it was the active row; there's no reason to invent new
            # values for a pack nobody can buy.
            ("wallpaper", 800, all_wallpaper_target_ids(), "disabled"),
        ],
    },
    {
        "slug": "heart-map",
        "name_i18n_key": "whereWeMet",
        "category": "map",
        "status": "available",
        "starting_price_cents": 800,
        "order": 3,
        "tags": ["map", "anniversary", "wedding"],
        # No `live` pack and no `landscape-png`: this product's renderer
        # produces four PNG sizes and has no digital/HTML renderer. Not
        # part of the pack/pricing rework — unchanged from its original
        # four-field shape, so it still uses a 3-tuple; the loop below
        # defaults a 3-tuple's status to "active".
        "packs": [
            ("printable", 1800, ["print-png"]),
            ("wallpaper", 800, ["story-png", "portrait-png"]),
            ("complete", 2400, ["story-png", "square-png", "portrait-png", "print-png"]),
        ],
    },
    {
        "slug": "song-poster",
        "name_i18n_key": "songPoster",
        "category": "music",
        "status": "available",
        # These are now REAL, decided prices — the five-tier commercial
        # structure (Digital / Digital+Wallpapers / Printable /
        # Printable+Wallpapers / Complete) FastSpring's own new catalog
        # defines, matching Love Story Timeline's structure exactly.
        # `starting_price_cents` updated to match: $15.99 is the actual
        # cheapest real pack below (`live`), not a placeholder guess —
        # this field is written verbatim to `Product.starting_price_cents`
        # by `seed()` below, the same protected-on-re-run mechanism every
        # other price in this file already uses.
        "starting_price_cents": 1599,
        "order": 5,
        "tags": ["poster", "song", "music", "gift"],
        # No per-theme distinction here at all: a pack grants access to
        # TARGET IDS (a print size + mounting, or a wallpaper device),
        # never to a specific one of the eight themes — `render_png`
        # resolves which theme's composition to draw, including the
        # landscape-vs-portrait orientation swap for Award/Sleeve, from
        # the PROJECT's own theme selection, not from anything the pack
        # itself encodes. The same pack works for every theme unchanged.
        "packs": [
            ("printable", 2299, all_print_target_ids(), "active"),
            # Standalone Wallpaper — deliberately UNCHANGED (price,
            # targets, status, and its position in this list) by an
            # explicit instruction: this pack is not part of the new
            # five-tier commercial structure below, and whether to
            # disable/retire it (matching Love Story Timeline's own
            # already-disabled standalone wallpaper pack) is a separate,
            # not-yet-made decision — not something to infer from the
            # new catalog's silence about it.
            ("wallpaper", 799, all_wallpaper_target_ids(), "active"),
            (
                "printable-plus-wallpaper",
                2799,
                [*all_print_target_ids(), *all_wallpaper_target_ids()],
                "active",
            ),
            # NEW — this product's live page (`song-live-keepsake.tsx`,
            # `live_views.py`'s product dispatch) has been real and
            # shipped for some time; no DeliveryPack ever sold access to
            # it. `__live__` is confirmed product-agnostic end to end
            # (`apps/commerce/services.py`'s `grant_entitlements`, and
            # `apps/delivery/services.py`'s delivery-result branch both
            # branch on the sentinel alone, never on which product the
            # order is for) — this is a pure catalog addition, copied
            # from Love Story Timeline's own equivalent pack and
            # repriced, not new fulfillment logic.
            ("live", 1599, ["__live__"], "active"),
            # NEW — same reasoning, the wallpaper-combo equivalent.
            ("digital-plus-wallpaper", 2099, ["__live__", *all_wallpaper_target_ids()], "active"),
            # "Complete" now means everything sellable, matching Love
            # Story Timeline's own Complete and the new commercial
            # definition of this tier: every print, every wallpaper, AND
            # the live page. Previously print + wallpaper only, because
            # no live pack existed yet to include — that gap is what
            # this change closes. `"__live__"` added; nothing else in
            # this pack's targets removed or altered.
            (
                "complete",
                3999,
                [*all_print_target_ids(), *all_wallpaper_target_ids(), "__live__"],
                "active",
            ),
        ],
    },
    {
        "slug": "graduation-keepsake",
        "name_i18n_key": "graduationKeepsake",
        # `other`, not a new `graduation` category: `Product.category` is
        # guarded by a CHECK constraint (`ck_products_category_valid`), so a
        # new value needs a migration, and migrations are run by hand. The
        # category is only a grouping label today; revisit if it ever drives
        # UI.
        "category": "other",
        # `coming_soon`, unlike Song Poster's `available`-but-hidden: this
        # product has NO Freemius plan yet (`FREEMIUS_PLAN_MAPPING` has no
        # `graduation-keepsake:live`), so an order for it could not be paid.
        # Flip this to `available` in the same change that un-hides it in the
        # frontend registry and maps its plan - ADDING-A-PRODUCT.md, step 7.
        "status": "coming_soon",
        # $15.99 - a PLACEHOLDER at the same Digital tier as Love Story
        # Timeline and Song Poster, until the Freemius plan fixes the real
        # price. `seed()` never overwrites a price already in the database
        # unless `--update-prices` is passed.
        "starting_price_cents": 1599,
        "order": 6,
        "tags": ["graduation", "gift", "photos", "messages"],
        # LIVE-ONLY. One pack whose only target is the hosted page. More packs
        # (a printable, wallpapers) may come later: they are just more rows
        # here, plus a print renderer and a widened `supported_targets()`.
        "packs": [
            ("live", 1599, ["__live__"], "active"),
        ],
    },
]


def supported_targets(product_slug):
    """Targets the product's registered renderer can actually produce.

    Returns None when no real renderer is registered, in which case
    nothing is validated — the same rule the admin form applies.
    """
    from apps.delivery.delivery_types import LIVE_TARGET_SENTINEL
    from apps.delivery.print_sizes import print_target_dimensions
    from apps.delivery.wallpaper_devices import wallpaper_target_dimensions
    from apps.delivery.product_renderers.love_story_timeline.png_renderer import (
        TARGET_DIMENSIONS as LOVE_STORY_TIMELINE_TARGETS,
    )
    from apps.delivery.product_renderers.where_we_met_map.png_renderer import (
        TARGET_DIMENSIONS as WHERE_WE_MET_MAP_TARGETS,
    )

    return {
        "love-story-timeline": set(LOVE_STORY_TIMELINE_TARGETS) | {LIVE_TARGET_SENTINEL},
        "heart-map": set(WHERE_WE_MET_MAP_TARGETS),
        # Song Poster has no product-specific TARGET_DIMENSIONS dict the
        # way LST/heart-map do — it has no legacy targets to merge in
        # (brand new product), so it validates directly against the
        # shared print/wallpaper catalog both of those are ALSO built
        # from underneath (see love_story_timeline/png_renderer.py's own
        # TARGET_DIMENSIONS = {**print_target_dimensions(),
        # **wallpaper_target_dimensions(), **_LEGACY_TARGET_DIMENSIONS}).
        # __live__ included: the live page itself is real and shipped
        # (song-live-keepsake.tsx, live_views.py's product dispatch) —
        # whether a PACK sells access to it yet is the separate,
        # deliberately-not-decided-here question the CATALOG entry below
        # leaves open.
        "song-poster": set(print_target_dimensions()) | set(wallpaper_target_dimensions()) | {LIVE_TARGET_SENTINEL},
        # Live-only for now: the hosted page is the only thing it can
        # deliver. Widen this set together with a print renderer.
        "graduation-keepsake": {LIVE_TARGET_SENTINEL},
    }.get(product_slug)


def validate(entry):
    """Fails loudly before writing anything, rather than half-seeding."""
    problems = []
    supported = supported_targets(entry["slug"])

    for pack in entry["packs"]:
        # Packs are 3-tuples (slug, price_cents, targets) or 4-tuples with
        # an explicit trailing status — see the CATALOG comment above for
        # why love-story-timeline needs the 4-tuple form and heart-map
        # doesn't. A 3-tuple defaults to "active", unchanged from before.
        pack_slug, price_cents, targets = pack[0], pack[1], pack[2]
        status = pack[3] if len(pack) > 3 else "active"
        if status not in ("active", "disabled"):
            problems.append(f"{entry['slug']}/{pack_slug}: status must be 'active' or 'disabled', got {status!r}")

        where = f"{entry['slug']}/{pack_slug}"
        if not targets:
            problems.append(f"{where}: no included targets")
        if len(set(targets)) != len(targets):
            problems.append(f"{where}: duplicate target")
        if price_cents <= 0:
            problems.append(f"{where}: price must be positive")
        if supported is not None:
            bad = [t for t in targets if t not in supported]
            if bad:
                problems.append(
                    f"{where}: renderer cannot produce {', '.join(sorted(bad))} "
                    f"(supported: {', '.join(sorted(supported))})"
                )
    return problems


@transaction.atomic
def seed(update_prices: bool = False):
    drift: list[str] = []
    problems = [p for entry in CATALOG for p in validate(entry)]
    if problems:
        print("REFUSING TO SEED — invalid catalog:\n")
        for problem in problems:
            print(f"  - {problem}")
        sys.exit(1)

    for entry in CATALOG:
        existing_product = Product.objects.filter(slug=entry["slug"]).first()
        product, created = Product.objects.update_or_create(
            slug=entry["slug"],
            defaults={
                "name_i18n_key": entry["name_i18n_key"],
                "category": entry["category"],
                "status": entry["status"],
                "order": entry["order"],
                "tags": entry["tags"],
                # `starting_price_cents` is the "from" figure the storefront
                # advertises, so it is a price like any other and gets the
                # same protection.
                **price_defaults(
                    existing_product,
                    "starting_price_cents",
                    entry["starting_price_cents"],
                    update_prices,
                    f"{entry['slug']} (starting price)",
                    drift,
                ),
            },
        )
        print(f"{'created' if created else 'updated'}  product  {product.slug}")

        for pack in entry["packs"]:
            # Same 3-tuple-or-4-tuple handling as validate() above.
            pack_slug, price_cents, targets = pack[0], pack[1], pack[2]
            status = pack[3] if len(pack) > 3 else "active"

            existing_pack = DeliveryPack.objects.filter(product=product, slug=pack_slug).first()
            pack_row, pack_created = DeliveryPack.objects.update_or_create(
                product=product,
                slug=pack_slug,
                defaults={
                    "name_i18n_key": f"packs.{pack_slug}.name",
                    "description_i18n_key": f"packs.{pack_slug}.description",
                    "currency": "USD",
                    "included_targets": targets,
                    # THIS USED TO BE HARDCODED TO "active" for every pack,
                    # unconditionally — there was no way to represent a
                    # disabled pack (the retired standalone `wallpaper`
                    # row) via this script at all. Fixed alongside making
                    # the catalog data itself current.
                    "status": status,
                    **price_defaults(
                        existing_pack,
                        "price_cents",
                        price_cents,
                        update_prices,
                        f"{product.slug}/{pack_slug}",
                        drift,
                    ),
                },
            )
            pack_row.refresh_from_db()
            print(
                f"{'created' if pack_created else 'updated'}  pack     "
                f"{product.slug}/{pack_row.slug}  ${pack_row.price_cents / 100:.2f}  "
                f"[{pack_row.status}]  {targets}"
            )

    if drift:
        print("\n--- PRICES LEFT UNCHANGED ---")
        print("The database and this file disagree. Nothing was written.")
        for line in drift:
            print(line)
        print("\nRun with --update-prices to overwrite the database with this file's prices.")
    elif not update_prices:
        print("\nPrices untouched (default). Use --update-prices to write them.")


def seed_catalog_entities():
    """Seeds Occasion and PrintSize from the values currently in code (§7d).

    These entities exist so the dashboard can manage them, but they start
    empty — and an empty table is worse than no table, because the storefront
    would show no occasions at all. Seeding them from the constants that are
    live today means the database matches reality from the first run, and
    editing takes over from there.

    Uses `get_or_create`, not `update_or_create`: once a row exists it is
    yours to edit, and re-running this to add a new occasion must not revert
    a name or an order you changed in the dashboard. Same principle as the
    price protection above.
    """
    from apps.delivery.print_sizes import PRINT_SIZES
    from apps.products.models import Occasion, PrintSize

    occasions = [
        ("anniversary", ["anniversary"], 1),
        ("wedding", ["wedding"], 2),
        ("newBaby", ["birth"], 3),
        ("inMemory", ["memorial"], 4),
        ("newChapter", ["housewarming"], 5),
    ]
    for key, tags, order in occasions:
        _, created = Occasion.objects.get_or_create(
            key=key, defaults={"tags": tags, "order": order, "is_active": True}
        )
        print(f"{'created' if created else 'kept   '}  occasion {key}")

    for index, (key, (width, height)) in enumerate(PRINT_SIZES.items(), start=1):
        _, created = PrintSize.objects.get_or_create(
            key=key,
            defaults={
                "base_width_px": width,
                "base_height_px": height,
                "order": index,
                "is_active": True,
            },
        )
        print(f"{'created' if created else 'kept   '}  size     {key} {width}x{height}")


def report():
    print("\n--- catalog now in the database ---")
    for product in Product.objects.order_by("order"):
        packs = product.delivery_packs.order_by("slug")
        print(f"\n{product.slug}  [{product.status}]  from ${product.starting_price_cents / 100:.2f}")
        for pack in packs:
            print(f"    {pack.slug:10} ${pack.price_cents / 100:>6.2f} {pack.currency}  {pack.included_targets}")

    # Computed from CATALOG itself, not a hardcoded string — the line
    # this replaces read "(expected: 2 products, 7 packs)" literally,
    # unchanged since before Song Poster (or even Where We Met's own
    # pack rework) existed in this file at all, so it had been silently
    # wrong for as long as either did. A hardcoded number can never
    # actually validate anything; it only ever restates whatever was
    # true the day it was typed. Deriving it from CATALOG restores what
    # this line was presumably always meant to do — catch real drift
    # between this file and the database (an orphaned row from a
    # product or pack removed here but never cleaned up there) — rather
    # than a number that goes stale the moment a product is added and
    # nobody remembers to update a second, disconnected copy of the count.
    actual_products, actual_packs = Product.objects.count(), DeliveryPack.objects.count()
    expected_products, expected_packs = len(CATALOG), sum(len(entry["packs"]) for entry in CATALOG)
    if (actual_products, actual_packs) == (expected_products, expected_packs):
        print(f"\ntotals: {actual_products} products, {actual_packs} packs  (matches this file)")
    else:
        print(
            f"\ntotals: {actual_products} products, {actual_packs} packs"
            f"  (this file describes {expected_products} products, {expected_packs} packs —"
            " the database has rows this file doesn't account for, or vice versa)"
        )


if __name__ == "__main__":
    # `--update-prices` is opt-in on purpose: writing a price should be
    # something you asked for, not a side effect of fixing a target list.
    update_prices = "--update-prices" in sys.argv
    if update_prices:
        print("--update-prices: this run WILL overwrite prices in the database.\n")
    seed(update_prices=update_prices)
    seed_catalog_entities()
    report()
