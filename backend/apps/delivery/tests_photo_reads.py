"""
A pack download must read each customer photo from storage ONCE, not once
per rendered file.

Measured against a real paid Printable order: 3 distinct photos were fetched
from R2 18 times (every print size and mounting re-fetched them), and ~90% of
the render's wall time was spent waiting on those reads — against gunicorn's
120s worker kill.
"""

import io
import zipfile
from unittest.mock import patch

from django.test import TestCase
from PIL import Image
from rest_framework.test import APIClient

from apps.assets.models import Asset
from apps.assets.services import get_asset_bytes_for_customer
from apps.commerce.order_access import generate_order_access_token

from .renderers import TemporaryFileResult
from .tests import make_asset, make_delivery_pack, make_paid_order_with_entitlements, make_product


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 120, 120)).save(buffer, format="PNG")
    return buffer.getvalue()


class _CountingStorage:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.downloads: list[str] = []

    def download(self, key):
        self.downloads.append(key)
        return self.payload


class PackPhotoReadTests(TestCase):
    PRINT_TARGETS = ["print-a4-frameless", "print-a4-edged", "print-classic-frameless", "print-classic-edged"]

    def setUp(self):
        self.client = APIClient()
        self.storage = _CountingStorage(_png())
        patcher = patch("apps.assets.services.get_asset_storage", return_value=self.storage)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _order(self, *, pack_slug, target_ids):
        product = make_product()
        pack = make_delivery_pack(product=product, slug=pack_slug, included_targets=target_ids)
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=target_ids, product=product, delivery_pack=pack
        )
        photo = make_asset(
            customer=customer, mime_type="image/png", status=Asset.STATUS_UPLOADED, storage_key="assets/photo.png"
        )

        class _PhotoRenderer:
            """Every target pastes the same photo, like the real poster
            renderer does for each print size and mounting."""

            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                data, _mime = get_asset_bytes_for_customer(customer, photo.id)
                return TemporaryFileResult(content=data, content_type="image/png", filename=f"{target_id}.png")

        return order, product, _PhotoRenderer()

    def test_printable_zip_reads_the_shared_photo_from_storage_once(self):
        order, product, renderer = self._order(pack_slug="printable", target_ids=self.PRINT_TARGETS)
        token = generate_order_access_token(order.id)

        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: renderer}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/printable/{token}/")

        self.assertEqual(response.status_code, 200)
        names = zipfile.ZipFile(io.BytesIO(response.content)).namelist()
        self.assertEqual(len([n for n in names if n.endswith(".png")]), len(self.PRINT_TARGETS))
        self.assertEqual(len(self.storage.downloads), 1)

    def test_whole_pack_stream_reads_the_shared_photo_from_storage_once(self):
        order, product, renderer = self._order(pack_slug="printable", target_ids=self.PRINT_TARGETS)
        token = generate_order_access_token(order.id)

        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: renderer}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/{token}/")
            content = b"".join(response.streaming_content)  # rendering is lazy: read inside the patch

        self.assertEqual(response.status_code, 200)
        names = zipfile.ZipFile(io.BytesIO(content)).namelist()
        self.assertEqual(len([n for n in names if n.endswith(".png")]), len(self.PRINT_TARGETS))
        self.assertEqual(len(self.storage.downloads), 1)

    def test_wallpaper_zip_reads_the_shared_photo_from_storage_once(self):
        targets = ["wallpaper-iphone-story", "wallpaper-android-story", "wallpaper-desktop-story"]
        order, product, renderer = self._order(pack_slug="wallpaper", target_ids=targets)
        token = generate_order_access_token(order.id)

        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: renderer}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/wallpapers/{token}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.storage.downloads), 1)

    def test_the_cache_does_not_outlive_the_streaming_response(self):
        """Two consecutive downloads are two requests: the second must read
        again, never reuse the first's copy."""
        order, product, renderer = self._order(pack_slug="printable", target_ids=self.PRINT_TARGETS)
        token = generate_order_access_token(order.id)

        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: renderer}):
            for _ in range(2):
                response = self.client.get(f"/api/v1/orders/{order.id}/download/{token}/")
                b"".join(response.streaming_content)

        self.assertEqual(len(self.storage.downloads), 2)
