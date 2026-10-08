"""
`prefetch_asset_bytes` — fetching an order's photos concurrently.

After de-duplication a pack still read its distinct photos one after another,
so a render cost the SUM of their R2 latencies (measured: 63s for three
photos, one read alone 28s). These tests pin down that it fetches together,
and — equally important — that it is only ever a warm-up: it never raises,
never changes who may read what, and does nothing for the common case.
"""

import threading
import time
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from apps.common.exceptions.api_errors import AssetAccessDenied

from .models import Asset
from .services import _AssetBytesCache, asset_bytes_cache, get_asset_bytes_for_customer, prefetch_asset_bytes
from .storage import AssetStorageError, read_time_left
from .tests import make_asset, make_customer


class _ProbeStorage:
    """Records every download and how many were in flight at once.

    With `barrier`, a download only completes once N downloads are in flight
    together — so it passes only if they really ran concurrently, and a
    sequential implementation breaks the barrier (and fails the test)
    instead of merely being slow.
    """

    def __init__(self, barrier=None, fail_first_for=(), block=None):
        self.barrier = barrier
        self.block = block
        self.fail_first_for = set(fail_first_for)
        self.downloads: list[str] = []
        self.budget_seen: list[float | None] = []
        self.in_flight = 0
        self.max_in_flight = 0
        self._lock = threading.Lock()

    def download(self, key):
        with self._lock:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            self.downloads.append(key)
            self.budget_seen.append(read_time_left())
            first_failure = key in self.fail_first_for
            self.fail_first_for.discard(key)
        try:
            if self.barrier is not None:
                self.barrier.wait(timeout=5)
            if self.block is not None:
                self.block.wait(30)
            if first_failure:
                raise AssetStorageError("boom")
            return b"photo-" + key.encode()
        finally:
            with self._lock:
                self.in_flight -= 1


class PrefetchAssetBytesTests(TestCase):
    def setUp(self):
        self.customer = make_customer()
        self.assets = [make_asset(customer=self.customer, status=Asset.STATUS_UPLOADED) for _ in range(3)]
        self.ids = [str(a.id) for a in self.assets]

    def _use(self, storage):
        patcher = patch("apps.assets.services.get_asset_storage", return_value=storage)
        patcher.start()
        self.addCleanup(patcher.stop)
        return storage

    def test_distinct_photos_are_fetched_at_the_same_time(self):
        storage = self._use(_ProbeStorage(barrier=threading.Barrier(3)))

        with asset_bytes_cache():
            warmed = prefetch_asset_bytes(self.customer, self.ids)

        self.assertEqual(warmed, 3)
        self.assertEqual(storage.max_in_flight, 3)

    def test_each_photo_is_fetched_exactly_once_and_later_reads_are_free(self):
        storage = self._use(_ProbeStorage())

        with asset_bytes_cache():
            prefetch_asset_bytes(self.customer, self.ids)
            with self.assertNumQueries(0):
                for _ in range(4):
                    for asset in self.assets:
                        data, mime = get_asset_bytes_for_customer(self.customer, asset.id)
                        self.assertTrue(data.startswith(b"photo-"))
                        self.assertEqual(mime, "image/png")

        self.assertEqual(len(storage.downloads), 3)

    def test_the_bytes_served_are_the_right_photos_bytes(self):
        self._use(_ProbeStorage())

        with asset_bytes_cache():
            prefetch_asset_bytes(self.customer, self.ids)
            for asset in self.assets:
                data, _ = get_asset_bytes_for_customer(self.customer, asset.id)
                self.assertEqual(data, b"photo-" + asset.storage_key.encode())

    def test_without_a_cache_block_it_does_nothing(self):
        storage = self._use(_ProbeStorage())

        self.assertEqual(prefetch_asset_bytes(self.customer, self.ids), 0)
        self.assertEqual(storage.downloads, [])

    def test_fewer_than_two_distinct_photos_costs_nothing_at_all(self):
        """The common case: no thread pool, no database query, no download."""
        storage = self._use(_ProbeStorage())

        with asset_bytes_cache():
            with self.assertNumQueries(0):
                self.assertEqual(prefetch_asset_bytes(self.customer, []), 0)
                self.assertEqual(prefetch_asset_bytes(self.customer, self.ids[:1]), 0)
                self.assertEqual(prefetch_asset_bytes(self.customer, [self.ids[0], self.ids[0]]), 0)

        self.assertEqual(storage.downloads, [])

    def test_another_customers_photo_is_skipped_and_still_refused_on_read(self):
        stranger_asset = make_asset(customer=make_customer(), status=Asset.STATUS_UPLOADED)
        storage = self._use(_ProbeStorage(barrier=threading.Barrier(2)))

        with asset_bytes_cache():
            warmed = prefetch_asset_bytes(self.customer, self.ids[:2] + [str(stranger_asset.id)])
            with self.assertRaises(AssetAccessDenied):
                get_asset_bytes_for_customer(self.customer, stranger_asset.id)

        self.assertEqual(warmed, 2)
        self.assertEqual(len(storage.downloads), 2)  # the stranger's object was never fetched

    def test_a_photo_that_does_not_exist_is_skipped_quietly(self):
        storage = self._use(_ProbeStorage(barrier=threading.Barrier(2)))

        with asset_bytes_cache():
            warmed = prefetch_asset_bytes(self.customer, self.ids[:2] + ["not-a-uuid", "00000000-0000-0000-0000-000000000000"])

        self.assertEqual(warmed, 2)

    def test_a_failed_fetch_is_not_fatal_and_is_read_on_demand_instead(self):
        failing_key = self.assets[1].storage_key
        storage = self._use(_ProbeStorage(fail_first_for=[failing_key]))

        with asset_bytes_cache():
            warmed = prefetch_asset_bytes(self.customer, self.ids)  # does not raise
            data, _ = get_asset_bytes_for_customer(self.customer, self.assets[1].id)

        self.assertEqual(warmed, 2)
        self.assertEqual(data, b"photo-" + failing_key.encode())
        self.assertEqual(storage.downloads.count(failing_key), 2)  # warm-up miss, then the on-demand read

    def test_it_never_raises_even_if_storage_itself_blows_up(self):
        with patch("apps.assets.services.get_asset_storage", side_effect=RuntimeError("no storage")):
            with asset_bytes_cache():
                self.assertEqual(prefetch_asset_bytes(self.customer, self.ids), 0)

    def test_it_stops_waiting_after_its_budget(self):
        release = threading.Event()
        self.addCleanup(release.set)
        self._use(_ProbeStorage(block=release))

        started = time.monotonic()
        with override_settings(ASSET_PREFETCH_BUDGET_SECONDS=1), asset_bytes_cache():
            warmed = prefetch_asset_bytes(self.customer, self.ids)
        elapsed = time.monotonic() - started

        self.assertEqual(warmed, 0)
        self.assertLess(elapsed, 4, "must carry on after the budget, not wait out the stuck reads")

    def test_worker_threads_run_under_the_requests_read_budget(self):
        """Threads start with an empty context; without an explicit copy the
        warm-up would silently read with NO budget."""
        storage = self._use(_ProbeStorage())

        with override_settings(ASSET_READ_BUDGET_SECONDS=90), asset_bytes_cache():
            prefetch_asset_bytes(self.customer, self.ids)

        self.assertEqual(len(storage.budget_seen), 3)
        for left in storage.budget_seen:
            self.assertIsNotNone(left)
            self.assertTrue(80 < left <= 90, left)

    def test_the_warm_up_never_waits_past_what_is_left_of_the_request_budget(self):
        release = threading.Event()
        self.addCleanup(release.set)
        self._use(_ProbeStorage(block=release))

        started = time.monotonic()
        # prefetch budget 50s, but the REQUEST only has 1s of read time left.
        with override_settings(ASSET_READ_BUDGET_SECONDS=1, ASSET_PREFETCH_BUDGET_SECONDS=50), asset_bytes_cache():
            warmed = prefetch_asset_bytes(self.customer, self.ids)
        elapsed = time.monotonic() - started

        self.assertEqual(warmed, 0)
        self.assertLess(elapsed, 4)

    def test_the_cache_block_opens_and_closes_the_request_read_budget(self):
        self.assertIsNone(read_time_left())
        with override_settings(ASSET_READ_BUDGET_SECONDS=90):
            with asset_bytes_cache():
                self.assertTrue(80 < read_time_left() <= 90)
                with asset_bytes_cache():
                    self.assertTrue(80 < read_time_left() <= 90)  # nested block: its own fresh budget
            self.assertIsNone(read_time_left())

    def test_it_never_evicts_what_is_already_cached(self):
        self._use(_ProbeStorage())

        # Room for exactly one of the ~43-byte photos.
        with asset_bytes_cache(max_bytes=60):
            warmed = prefetch_asset_bytes(self.customer, self.ids)

        self.assertEqual(warmed, 1)


class PutIfRoomTests(SimpleTestCase):
    def test_refuses_instead_of_evicting(self):
        cache = _AssetBytesCache(max_bytes=10)

        self.assertTrue(cache.put_if_room("a", (b"12345678", "x")))
        self.assertFalse(cache.put_if_room("b", (b"12345678", "x")))
        self.assertIsNotNone(cache.get("a"))  # still there
        self.assertIsNone(cache.get("b"))

    def test_does_not_overwrite_an_existing_entry(self):
        cache = _AssetBytesCache(max_bytes=100)
        cache.put_if_room("a", (b"first", "x"))

        self.assertFalse(cache.put_if_room("a", (b"second", "x")))
        self.assertEqual(cache.get("a")[0], b"first")
