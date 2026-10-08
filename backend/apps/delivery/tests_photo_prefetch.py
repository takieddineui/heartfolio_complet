"""
Pack downloads fetch an order's photos together — and are unchanged for the
common case of one or two photos.
"""

import io
import threading
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from PIL import Image
from rest_framework.test import APIClient

from apps.assets.models import Asset
from apps.assets.services import get_asset_bytes_for_customer
from apps.assets.storage import AssetStorageError
from apps.commerce.order_access import generate_order_access_token

from .photo_prefetch import photo_asset_ids
from .renderers import TemporaryFileResult
from .tests import make_asset, make_delivery_pack, make_paid_order_with_entitlements, make_product


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 120, 120)).save(buffer, format="PNG")
    return buffer.getvalue()


class PhotoAssetIdsTests(SimpleTestCase):
    def _project(self, values):
        return SimpleNamespace(data={"version": 1, "values": values})

    def test_love_story_timeline_event_photos(self):
        project = self._project({"events": [{"photo": {"assetId": "a1"}}, {"title": "no photo"}, {"photo": {"assetId": "a2"}}]})
        self.assertEqual(photo_asset_ids(project), ["a1", "a2"])

    def test_a_single_top_level_photo(self):
        """Song Poster and Where We Met."""
        self.assertEqual(photo_asset_ids(self._project({"photo": {"assetId": "p1"}})), ["p1"])

    def test_video_and_audio_are_never_collected(self):
        """A poster render never reads them; prefetching a video would be waste."""
        project = self._project(
            {"events": [{"photo": {"assetId": "a1"}, "video": {"assetId": "v1"}, "audio": {"assetId": "m1"}}]}
        )
        self.assertEqual(photo_asset_ids(project), ["a1"])

    def test_malformed_data_is_tolerated_not_raised(self):
        for values in (
            None,
            {},
            {"events": None},
            {"events": ["not-a-dict", 7, None]},
            {"photo": "just-a-string"},
            {"photo": {"assetId": ""}},
            {"photo": {"assetId": 123}},
            {"photo": None},
        ):
            self.assertEqual(photo_asset_ids(self._project(values)), [], values)

    def test_no_project_or_no_data(self):
        self.assertEqual(photo_asset_ids(None), [])
        self.assertEqual(photo_asset_ids(SimpleNamespace(data=None)), [])


class _ProbeStorage:
    """See assets/tests_prefetch.py. `barrier` only releases once N
    downloads are in flight together."""

    def __init__(self, payload, barrier=None, fail_first_for=()):
        self.payload = payload
        self.barrier = barrier
        self.fail_first_for = set(fail_first_for)
        self.downloads: list[str] = []
        self.in_flight = 0
        self.max_in_flight = 0
        self._lock = threading.Lock()

    def download(self, key):
        with self._lock:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            self.downloads.append(key)
            fail = key in self.fail_first_for
            self.fail_first_for.discard(key)
        try:
            if self.barrier is not None:
                self.barrier.wait(timeout=5)
            if fail:
                raise AssetStorageError("boom")
            return self.payload
        finally:
            with self._lock:
                self.in_flight -= 1


class PackPrefetchTests(TestCase):
    PRINT_TARGETS = ["print-a4-frameless", "print-a4-edged", "print-classic-frameless", "print-classic-edged"]

    def setUp(self):
        self.client = APIClient()
        self.payload = _png()

    def _use(self, storage):
        patcher = patch("apps.assets.services.get_asset_storage", return_value=storage)
        patcher.start()
        self.addCleanup(patcher.stop)
        return storage

    def _order(self, photo_count, *, pack_slug="printable", target_ids=None):
        target_ids = target_ids or self.PRINT_TARGETS
        product = make_product()
        pack = make_delivery_pack(product=product, slug=pack_slug, included_targets=target_ids)
        customer, order, _ = make_paid_order_with_entitlements(target_ids=target_ids, product=product, delivery_pack=pack)
        photos = [
            make_asset(
                customer=customer, mime_type="image/png", status=Asset.STATUS_UPLOADED, storage_key=f"assets/{uuid.uuid4().hex}-photo-{i}.png"
            )
            for i in range(photo_count)
        ]
        self.photos = photos
        order.project.data = {
            "version": 1,
            "values": {"events": [{"photo": {"assetId": str(p.id)}} for p in photos]},
            "themeSelections": {},
        }
        order.project.save()

        class _PhotosRenderer:
            """Every target reads every photo, like the real poster renderer."""

            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                for photo in photos:
                    data, _mime = get_asset_bytes_for_customer(customer, photo.id)
                return TemporaryFileResult(content=data, content_type="image/png", filename=f"{target_id}.png")

        return order, product, _PhotosRenderer()

    def _get(self, order, product, renderer, path):
        token = generate_order_access_token(order.id)
        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: renderer}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/{path}{token}/")
            if getattr(response, "streaming", False):
                response.content_bytes = b"".join(response.streaming_content)  # lazy: read inside the patch
            else:
                response.content_bytes = response.content
        return response

    @staticmethod
    def _entries(response):
        """Entry names, plus the contents of every PNG. PDFs are compared by
        name only: the PDF writer embeds a timestamp and document id, so two
        identical renders are never byte-identical."""
        archive = zipfile.ZipFile(io.BytesIO(response.content_bytes))
        return {name: (archive.read(name) if name.endswith(".png") else None) for name in archive.namelist()}

    def test_printable_zip_fetches_three_photos_together_and_each_once(self):
        storage = self._use(_ProbeStorage(self.payload, barrier=threading.Barrier(3)))
        order, product, renderer = self._order(3)

        response = self._get(order, product, renderer, "printable/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(storage.max_in_flight, 3)
        self.assertEqual(len(storage.downloads), 3)

    def test_whole_pack_stream_fetches_three_photos_together_and_each_once(self):
        storage = self._use(_ProbeStorage(self.payload, barrier=threading.Barrier(3)))
        order, product, renderer = self._order(3)

        response = self._get(order, product, renderer, "")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(storage.max_in_flight, 3)
        self.assertEqual(len(storage.downloads), 3)

    def test_wallpapers_zip_fetches_three_photos_together_and_each_once(self):
        storage = self._use(_ProbeStorage(self.payload, barrier=threading.Barrier(3)))
        order, product, renderer = self._order(
            3, pack_slug="wallpaper", target_ids=["wallpaper-phone", "wallpaper-tablet", "wallpaper-desktop"]
        )

        response = self._get(order, product, renderer, "wallpapers/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(storage.max_in_flight, 3)
        self.assertEqual(len(storage.downloads), 3)

    def test_one_photo_is_untouched_by_the_warm_up(self):
        """The common case: no concurrency, one download, same output."""
        storage = self._use(_ProbeStorage(self.payload))
        order, product, renderer = self._order(1)

        response = self._get(order, product, renderer, "printable/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(storage.max_in_flight, 1)
        self.assertEqual(len(storage.downloads), 1)

    def test_one_or_two_photos_produce_exactly_the_same_archive_as_without_prefetch(self):
        for photo_count in (1, 2):
            for path in ("printable/", ""):
                with self.subTest(photos=photo_count, route=path or "whole-pack"):
                    with_storage = self._use(_ProbeStorage(self.payload))
                    order, product, renderer = self._order(photo_count)
                    with_prefetch = self._get(order, product, renderer, path)
                    downloads_with = len(with_storage.downloads)

                    without_storage = self._use(_ProbeStorage(self.payload))
                    with patch("apps.delivery.views.prefetch_order_photos", return_value=0):
                        without_prefetch = self._get(order, product, renderer, path)

                    self.assertEqual(self._entries(with_prefetch), self._entries(without_prefetch))
                    self.assertEqual(downloads_with, photo_count)
                    self.assertEqual(len(without_storage.downloads), photo_count)

    def test_a_photo_the_warm_up_could_not_fetch_is_still_delivered(self):
        storage = self._use(_ProbeStorage(self.payload))
        order, product, renderer = self._order(3)
        failing_key = self.photos[1].storage_key
        storage.fail_first_for.add(failing_key)

        response = self._get(order, product, renderer, "printable/")

        self.assertEqual(response.status_code, 200)
        archive = zipfile.ZipFile(io.BytesIO(response.content_bytes))
        self.assertIsNone(archive.testzip())
        self.assertEqual(storage.downloads.count(failing_key), 2)  # warm-up miss, then on-demand

    def test_an_order_with_no_project_still_downloads(self):
        storage = self._use(_ProbeStorage(self.payload))
        product = make_product()
        pack = make_delivery_pack(product=product, slug="printable", included_targets=self.PRINT_TARGETS)
        _customer, order, _ = make_paid_order_with_entitlements(
            target_ids=self.PRINT_TARGETS, product=product, delivery_pack=pack, with_project=False
        )

        class _Plain:
            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                return TemporaryFileResult(content=self.png, content_type="image/png", filename=f"{target_id}.png")

            png = self.payload

        response = self._get(order, product, _Plain(), "printable/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(storage.downloads, [])
