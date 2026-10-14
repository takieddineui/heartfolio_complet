"""
Model/database-layer tests for `Product` and `DeliveryPack`. Where a
constraint is a database CHECK/UNIQUE constraint (not a Python-level
validation), the test deliberately assigns invalid data directly to
model fields and calls `.save()` — Django's ORM does not proactively
enforce `choices` or `CheckConstraint`s in Python at save time (only
`full_clean()` does), so a plain `.save()` reaching the database is
enough to prove the constraint is enforced at the database level, not
only by `full_clean()`.
"""

import uuid

from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework import status as http_status
from rest_framework.test import APIClient

from .models import DeliveryPack, Product


def make_product(**overrides) -> Product:
    defaults = {
        "slug": f"product-{uuid.uuid4().hex[:8]}",
        "name_i18n_key": "product.name",
        "category": Product.CATEGORY_OTHER,
        "status": Product.STATUS_COMING_SOON,
    }
    defaults.update(overrides)
    return Product.objects.create(**defaults)


class ProductModelTests(TestCase):
    def test_uuid_pk_is_generated(self):
        product = make_product()
        self.assertIsInstance(product.id, uuid.UUID)

    def test_slug_uniqueness_enforced_at_db_level(self):
        make_product(slug="love-story-timeline")
        with transaction.atomic(), self.assertRaises(IntegrityError):
            make_product(slug="love-story-timeline")

    def test_invalid_category_rejected_at_db_level(self):
        product = Product(
            slug="bad-category",
            name_i18n_key="x",
            category="not-a-real-category",
            status=Product.STATUS_COMING_SOON,
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            product.save()

    def test_invalid_status_rejected_at_db_level(self):
        product = Product(
            slug="bad-status",
            name_i18n_key="x",
            category=Product.CATEGORY_OTHER,
            status="not-a-real-status",
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            product.save()

    def test_negative_starting_price_rejected_at_db_level(self):
        product = Product(
            slug="negative-price",
            name_i18n_key="x",
            category=Product.CATEGORY_OTHER,
            starting_price_cents=-1,
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            product.save()

    def test_tags_must_be_json_array_at_db_level(self):
        product = Product(
            slug="bad-tags",
            name_i18n_key="x",
            category=Product.CATEGORY_OTHER,
            tags={"not": "an array"},
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            product.save()

    def test_tags_default_is_empty_array(self):
        product = make_product()
        self.assertEqual(product.tags, [])


class DeliveryPackModelTests(TestCase):
    def test_product_relationship(self):
        product = make_product()
        pack = DeliveryPack.objects.create(
            product=product,
            slug="printable",
            name_i18n_key="pack.printable.name",
            description_i18n_key="pack.printable.description",
            price_cents=1200,
        )
        self.assertEqual(pack.product_id, product.id)
        self.assertIn(pack, product.delivery_packs.all())

    def test_product_and_slug_uniqueness_enforced_at_db_level(self):
        product = make_product()
        DeliveryPack.objects.create(
            product=product, slug="printable", name_i18n_key="a", description_i18n_key="a", price_cents=1000
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            DeliveryPack.objects.create(
                product=product, slug="printable", name_i18n_key="b", description_i18n_key="b", price_cents=2000
            )

    def test_same_slug_allowed_across_different_products(self):
        product_a = make_product()
        product_b = make_product()
        DeliveryPack.objects.create(
            product=product_a, slug="printable", name_i18n_key="a", description_i18n_key="a", price_cents=1000
        )
        # Should not raise — uniqueness is scoped to (product, slug).
        DeliveryPack.objects.create(
            product=product_b, slug="printable", name_i18n_key="b", description_i18n_key="b", price_cents=1000
        )

    def test_negative_price_rejected_at_db_level(self):
        product = make_product()
        pack = DeliveryPack(
            product=product, slug="printable", name_i18n_key="a", description_i18n_key="a", price_cents=-1
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            pack.save()

    def test_included_targets_must_be_json_array_at_db_level(self):
        product = make_product()
        pack = DeliveryPack(
            product=product,
            slug="printable",
            name_i18n_key="a",
            description_i18n_key="a",
            price_cents=1000,
            included_targets={"not": "an array"},
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            pack.save()

    def test_included_targets_is_a_flat_string_array(self):
        """Per the approved contract: ["print-png", "story-png", "__live__"],
        not [{"targetGroup": ..., "formatId": ...}] objects.
        """
        product = make_product()
        pack = DeliveryPack.objects.create(
            product=product,
            slug="complete",
            name_i18n_key="a",
            description_i18n_key="a",
            price_cents=3000,
            included_targets=["print-png", "story-png", "square-png", "__live__"],
        )
        pack.refresh_from_db()
        self.assertEqual(pack.included_targets, ["print-png", "story-png", "square-png", "__live__"])
        self.assertTrue(all(isinstance(t, str) for t in pack.included_targets))

    def test_invalid_status_rejected_at_db_level(self):
        product = make_product()
        pack = DeliveryPack(
            product=product,
            slug="printable",
            name_i18n_key="a",
            description_i18n_key="a",
            price_cents=1000,
            status="not-a-real-status",
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            pack.save()

    def test_deleting_product_is_restricted_by_delivery_pack(self):
        product = make_product()
        DeliveryPack.objects.create(
            product=product, slug="printable", name_i18n_key="a", description_i18n_key="a", price_cents=1000
        )
        with self.assertRaises(Exception):
            # RestrictedError at the ORM level; the underlying DB
            # constraint (NO ACTION, Django's default for RESTRICT)
            # would block a raw SQL delete the same way.
            product.delete()


class ProductCatalogAPITests(TestCase):
    """`GET /api/v1/products/` and `GET /api/v1/products/<slug>/` — no
    session/authentication required; public read-only endpoints.
    """

    def setUp(self):
        self.client = APIClient()

    def test_list_only_returns_available_products(self):
        make_product(slug="available-one", status=Product.STATUS_AVAILABLE)
        make_product(slug="waitlisted-one", status=Product.STATUS_WAITLIST)
        make_product(slug="coming-soon-one", status=Product.STATUS_COMING_SOON)
        make_product(slug="disabled-one", status=Product.STATUS_DISABLED)

        response = self.client.get("/api/v1/products/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        # THE LIST ENDPOINT RETURNS AN OBJECT, NOT AN ARRAY. It answers
        # with {"products", "occasions", "printSizes", "reviews",
        # "ratingSummary"} — the catalog page needs all of it in one
        # request. Iterating `response.data` directly walked the dict's
        # KEYS (strings), hence "string indices must be integers".
        slugs = {item["slug"] for item in response.data["products"]}
        self.assertEqual(slugs, {"available-one"})

    def test_disabled_and_coming_soon_products_excluded_from_listing(self):
        make_product(slug="hidden", status=Product.STATUS_COMING_SOON)
        response = self.client.get("/api/v1/products/")
        self.assertNotIn("hidden", {item["slug"] for item in response.data["products"]})

    def test_product_detail_by_slug(self):
        product = make_product(slug="love-story-timeline", status=Product.STATUS_AVAILABLE)
        response = self.client.get("/api/v1/products/love-story-timeline/")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["product"]["slug"], "love-story-timeline")
        self.assertEqual(response.data["product"]["id"], str(product.id))

    def test_unavailable_product_detail_returns_404(self):
        make_product(slug="not-yet", status=Product.STATUS_COMING_SOON)
        response = self.client.get("/api/v1/products/not-yet/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["error"]["code"], "product_not_found")

    def test_unknown_product_detail_returns_404(self):
        response = self.client.get("/api/v1/products/does-not-exist/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_delivery_packs_returned_in_product_detail(self):
        product = make_product(slug="heart-map", status=Product.STATUS_AVAILABLE)
        DeliveryPack.objects.create(
            product=product,
            slug="printable",
            name_i18n_key="a",
            description_i18n_key="a",
            price_cents=1200,
            included_targets=["print-png"],
        )
        response = self.client.get("/api/v1/products/heart-map/")
        pack_slugs = {p["slug"] for p in response.data["deliveryPacks"]}
        self.assertEqual(pack_slugs, {"printable"})

    def test_disabled_packs_not_publicly_purchasable_via_catalog(self):
        product = make_product(slug="heart-map-2", status=Product.STATUS_AVAILABLE)
        DeliveryPack.objects.create(
            product=product, slug="printable", name_i18n_key="a", description_i18n_key="a", price_cents=1200
        )
        DeliveryPack.objects.create(
            product=product,
            slug="disabled-pack",
            name_i18n_key="a",
            description_i18n_key="a",
            price_cents=1200,
            status=DeliveryPack.STATUS_DISABLED,
        )
        response = self.client.get("/api/v1/products/heart-map-2/")
        pack_slugs = {p["slug"] for p in response.data["deliveryPacks"]}
        self.assertEqual(pack_slugs, {"printable"})


class ProductCatalogContractTests(TestCase):
    """Phase 3.6 — field naming checked directly against the frontend's
    real `ProductEntry`/`DeliveryPack` TypeScript interfaces, and
    ordering/slug-identifier rules.
    """

    def setUp(self):
        self.client = APIClient()

    def test_product_uses_i18n_key_field_name(self):
        """`ProductEntry.i18nKey`, not `nameI18nKey` — src/lib/products/types.ts."""
        make_product(slug="star-map", status=Product.STATUS_AVAILABLE)
        response = self.client.get("/api/v1/products/")
        self.assertIn("i18nKey", response.data["products"][0])
        self.assertNotIn("nameI18nKey", response.data["products"][0])

    def test_delivery_pack_uses_name_key_and_description_key(self):
        """`DeliveryPack.nameKey`/`.descriptionKey`, not
        `nameI18nKey`/`descriptionI18nKey` — src/types/commerce.ts.
        """
        product = make_product(slug="song-poster", status=Product.STATUS_AVAILABLE)
        DeliveryPack.objects.create(
            product=product, slug="printable", name_i18n_key="a", description_i18n_key="b", price_cents=1000
        )
        response = self.client.get("/api/v1/products/song-poster/")
        pack = response.data["deliveryPacks"][0]
        self.assertEqual(pack["nameKey"], "a")
        self.assertEqual(pack["descriptionKey"], "b")
        self.assertNotIn("nameI18nKey", pack)
        self.assertNotIn("descriptionI18nKey", pack)

    def test_delivery_pack_includes_product_id_as_slug(self):
        product = make_product(slug="heart-map", status=Product.STATUS_AVAILABLE)
        DeliveryPack.objects.create(
            product=product, slug="printable", name_i18n_key="a", description_i18n_key="b", price_cents=1000
        )
        response = self.client.get("/api/v1/products/heart-map/")
        self.assertEqual(response.data["deliveryPacks"][0]["productId"], "heart-map")

    def test_product_never_exposes_internal_uuid_as_the_identifier_field(self):
        """The frontend identifies products by slug only. `id` (the raw
        UUID) is still present as the REST resource identifier — see
        module docstring precedent from Order/Project/Asset — but
        `slug` is what every request-side reference uses.
        """
        product = make_product(slug="love-story-timeline", status=Product.STATUS_AVAILABLE)
        response = self.client.get("/api/v1/products/love-story-timeline/")
        self.assertEqual(response.data["product"]["slug"], "love-story-timeline")
        self.assertEqual(response.data["product"]["id"], str(product.id))

    def test_listing_order_follows_product_order_field_not_insertion_order(self):
        # Insert in an order deliberately opposite to the desired display order.
        make_product(slug="third", order=3, status=Product.STATUS_AVAILABLE)
        make_product(slug="first", order=1, status=Product.STATUS_AVAILABLE)
        make_product(slug="second", order=2, status=Product.STATUS_AVAILABLE)

        response = self.client.get("/api/v1/products/")
        self.assertEqual(
            [p["slug"] for p in response.data["products"]], ["first", "second", "third"]
        )


class CatalogTargetMapParityTests(TestCase):
    """The admin form and the seed script each hardcode which targets a
    product can be sold with (`_supported_targets` in admin.py,
    `supported_targets` in seed_catalog.py). They drifted: Song Poster was in
    the seed's map and missing from the admin's, so the admin validated nothing
    for its packs. Every product the seed knows must be in both, with the same
    targets (the admin adds a product's AR targets on top, from its own
    opt-in, which the seed does not sell).
    """

    def test_every_seeded_product_has_the_same_targets_in_both_maps(self):
        import seed_catalog
        from apps.delivery.ar_support import supported_ar_targets

        from .admin import _supported_targets

        slugs = [entry["slug"] for entry in seed_catalog.CATALOG]
        self.assertIn("song-poster", slugs)
        for slug in slugs:
            with self.subTest(slug=slug):
                seeded = seed_catalog.supported_targets(slug)
                admin = _supported_targets(slug)
                self.assertIsNotNone(seeded, f"{slug} is missing from seed_catalog.supported_targets")
                self.assertIsNotNone(admin, f"{slug} is missing from admin._supported_targets")
                self.assertEqual(admin - supported_ar_targets(slug), seeded)

    def test_the_admin_form_now_refuses_a_target_song_poster_cannot_deliver(self):
        import json

        from .admin import DeliveryPackForm

        product = make_product(slug="song-poster")

        def target_errors(targets):
            form = DeliveryPackForm(data={"product": product.pk, "included_targets": json.dumps(targets)})
            form.is_valid()
            return form.errors.get("included_targets")

        self.assertIn("cannot produce: not-a-target", " ".join(target_errors(["__live__", "not-a-target"])))
        self.assertIsNone(target_errors(["__live__"]))
