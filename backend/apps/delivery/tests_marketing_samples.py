"""`render_marketing_samples`: the storefront captures' source.

What matters: it only ever runs against mock storage and the local database,
it leaves nothing behind, and every sample is something the real live page
would serve (built by the real payload builders, after their validation).
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from unittest import mock

from django.db import connection
from django.test import TestCase, override_settings

from apps.delivery.marketing_samples.build import (
    LOCALES,
    PHOTOS_DIR,
    PRODUCTS,
    SAMPLES_DIR,
    UnsafeEnvironment,
    build_bundle,
    load_samples,
)


def _photos_in(node, found=None):
    found = set() if found is None else found
    if isinstance(node, dict):
        if set(node) == {"$photo"}:
            found.add(node["$photo"])
        for value in node.values():
            _photos_in(value, found)
    elif isinstance(node, list):
        for item in node:
            _photos_in(item, found)
    return found


class SafetyTests(TestCase):
    @override_settings(ASSET_STORAGE_BACKEND="r2")
    def test_it_refuses_real_storage(self):
        with self.assertRaises(UnsafeEnvironment):
            build_bundle(products=["reasons-i-love-you"], locales=("en",))

    def test_it_refuses_a_database_that_is_not_local(self):
        settings_dict = {**connection.settings_dict, "HOST": "aws-0-eu-west-1.pooler.supabase.com"}
        with mock.patch.object(connection, "settings_dict", settings_dict):
            with self.assertRaises(UnsafeEnvironment):
                build_bundle(products=["reasons-i-love-you"], locales=("en",))


@override_settings(ASSET_STORAGE_BACKEND="mock")
class BundleTests(TestCase):
    def _bundle(self, product, locale):
        from apps.customers.models import Customer
        from apps.commerce.models import Order

        customers, orders = Customer.objects.count(), Order.objects.count()
        data = build_bundle(products=[product], locales=(locale,), site_url="https://shop.example")
        # Rolled back: no customer, order or anything else is left behind.
        self.assertEqual((Customer.objects.count(), Order.objects.count()), (customers, orders))
        return zipfile.ZipFile(io.BytesIO(data))

    def test_a_live_only_product_gets_its_real_payload_photos_and_qr(self):
        bundle = self._bundle("reasons-i-love-you", "fr")
        names = set(bundle.namelist())
        self.assertIn("payloads/reasons-i-love-you.fr.json", names)
        self.assertIn("qr/reasons-i-love-you.fr.png", names)
        self.assertFalse(any(name.startswith("prints/") for name in names))

        payload = json.loads(bundle.read("payloads/reasons-i-love-you.fr.json"))
        self.assertEqual((payload["productId"], payload["locale"]), ("reasons-i-love-you", "fr"))
        text = json.dumps(payload)
        self.assertNotIn("mock://", text)
        # Every photo link points at a file the bundle carries.
        for link in re.findall(r"/capture-assets/([^\"]+)", text):
            self.assertIn(f"assets/{link}", names)
        self.assertEqual(sum(1 for r in payload["values"]["reasons"] if r["photo"]), 4)
        self.assertTrue(bundle.read("qr/reasons-i-love-you.fr.png").startswith(b"\x89PNG"))

    def test_a_printable_product_also_gets_its_print(self):
        bundle = self._bundle("song-poster", "en")
        self.assertTrue(bundle.read("prints/song-poster.en.png").startswith(b"\x89PNG"))
        payload = json.loads(bundle.read("payloads/song-poster.en.json"))
        self.assertEqual(payload["values"]["track"], "Slow Dance in the Kitchen")
        self.assertTrue(payload["values"]["photo"]["url"].startswith("/capture-assets/"))

    def test_the_qr_card_opens_the_product_page(self):
        # The build imports the card renderer when it runs, so patching the
        # module attribute is enough.
        with mock.patch("apps.delivery.bonuses._render_qr_card", return_value=b"\x89PNG") as card:
            self._bundle("graduation-keepsake", "ar")
        self.assertEqual(card.call_args.args[0], "https://shop.example/ar/products/graduation-keepsake")


class SampleFilesTests(TestCase):
    def test_every_product_has_a_sample_in_every_locale(self):
        samples = load_samples()
        self.assertEqual(set(samples), set(PRODUCTS))
        for product, by_locale in samples.items():
            self.assertEqual(set(by_locale), set(LOCALES), product)

    def test_every_photo_is_present_used_and_licensed(self):
        used = _photos_in(load_samples())
        on_disk = {path.name for path in PHOTOS_DIR.glob("*.jpg")}
        self.assertEqual(used, on_disk, "photos referenced by samples.json and the files in photos/ differ")
        licences = (SAMPLES_DIR / "PHOTOS.md").read_text(encoding="utf-8")
        for name in on_disk:
            self.assertRegex(licences, rf"\| `{re.escape(name)}` \|.*\| https://unsplash\.com/photos/", name)
