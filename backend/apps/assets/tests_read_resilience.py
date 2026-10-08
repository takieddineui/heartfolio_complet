"""
R2 read resilience and the per-request photo cache.

Both exist because a pack render was measured spending ~90% of its time
waiting on R2: a Printable pack read 3 distinct photos 18 times, and single
0.6MB reads occasionally took 17-87s, against a 120s gunicorn worker kill.
"""

from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError, ReadTimeoutError
from django.test import SimpleTestCase, TestCase

from apps.common.exceptions.api_errors import AssetAccessDenied, AssetDownloadFailed

from .models import Asset
from .services import _AssetBytesCache, asset_bytes_cache, get_asset_bytes_for_customer
from .storage import AssetStorageError, R2Storage, _s3_client
from .tests import make_asset, make_customer


class _FakeBody:
    """Stands in for botocore's `StreamingBody`: only `iter_chunks` and
    `close`, which is everything `R2Storage._read_body` touches."""

    def __init__(self, chunks=(), raises=None):
        self._chunks = list(chunks)
        self._raises = raises
        self.closed = False

    def iter_chunks(self, chunk_size):
        yield from self._chunks
        if self._raises is not None:
            raise self._raises

    def close(self):
        self.closed = True


def _timeout():
    return ReadTimeoutError(endpoint_url="https://r2.example")


def _r2_with_client(client):
    with patch("apps.assets.storage._s3_client", return_value=client):
        return R2Storage()


class R2ClientConfigTests(SimpleTestCase):
    def setUp(self):
        _s3_client.cache_clear()
        self.addCleanup(_s3_client.cache_clear)

    def test_the_client_is_built_with_timeouts_and_retries(self):
        with patch("apps.assets.storage.boto3.client") as build:
            R2Storage()

        config = build.call_args.kwargs["config"]
        self.assertEqual(config.connect_timeout, 5)
        self.assertEqual(config.read_timeout, 15)
        self.assertEqual(config.retries["max_attempts"], 3)
        self.assertEqual(config.retries["mode"], "standard")

    def test_one_client_is_shared_across_instances(self):
        """`get_asset_storage()` builds a new `R2Storage` per call; without
        sharing, every photo read paid for a new client and TLS handshake."""
        with patch("apps.assets.storage.boto3.client") as build:
            R2Storage()
            R2Storage()
            R2Storage()

        self.assertEqual(build.call_count, 1)


class R2DownloadRetryTests(SimpleTestCase):
    def test_a_timed_out_read_is_retried_and_the_retry_wins(self):
        stalled = _FakeBody(chunks=[b"par"], raises=_timeout())
        good = _FakeBody(chunks=[b"whole-", b"photo"])
        client = MagicMock()
        client.get_object.side_effect = [{"Body": stalled}, {"Body": good}]

        data = _r2_with_client(client).download("assets/a.png")

        self.assertEqual(data, b"whole-photo")  # nothing from the failed attempt leaks in
        self.assertEqual(client.get_object.call_count, 2)
        self.assertTrue(stalled.closed)

    def test_gives_up_after_the_configured_attempts_with_a_storage_error(self):
        client = MagicMock()
        client.get_object.side_effect = lambda **kw: {"Body": _FakeBody(raises=_timeout())}

        with self.settings(R2_DOWNLOAD_ATTEMPTS=3):
            with self.assertRaises(AssetStorageError):
                _r2_with_client(client).download("assets/a.png")

        self.assertEqual(client.get_object.call_count, 3)

    def test_a_definite_answer_from_r2_is_not_retried(self):
        client = MagicMock()
        client.get_object.side_effect = ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject"
        )

        with self.assertRaises(AssetStorageError):
            _r2_with_client(client).download("assets/a.png")

        self.assertEqual(client.get_object.call_count, 1)

    def test_a_read_that_trickles_past_the_deadline_is_abandoned_and_retried(self):
        """The socket READ timeout is an idle timeout — it never fires on a
        connection that keeps delivering a few bytes. The deadline is what
        catches that."""
        slow = _FakeBody(chunks=[b"x"])
        good = _FakeBody(chunks=[b"fast"])
        client = MagicMock()
        client.get_object.side_effect = [{"Body": slow}, {"Body": good}]

        clock = MagicMock()
        # attempt 1: starts at 0 (deadline 1s), first chunk lands at t=2 -> over.
        # attempt 2: starts at 10, its one chunk lands at 10.1 -> fine.
        clock.monotonic.side_effect = [0, 2, 10, 10.1]

        with self.settings(R2_DOWNLOAD_DEADLINE_SECONDS=1), patch("apps.assets.storage.time", clock):
            data = _r2_with_client(client).download("assets/a.png")

        self.assertEqual(data, b"fast")
        self.assertEqual(client.get_object.call_count, 2)
        self.assertTrue(slow.closed)


class _CountingStorage:
    """Records every download so a test can assert how many times R2 would
    have been hit."""

    def __init__(self, payload=b"photo-bytes"):
        self.payload = payload
        self.downloads = []

    def download(self, key):
        self.downloads.append(key)
        return self.payload


class AssetBytesCacheTests(TestCase):
    def setUp(self):
        self.customer = make_customer()
        self.asset = make_asset(customer=self.customer, status=Asset.STATUS_UPLOADED)
        self.storage = _CountingStorage()
        patcher = patch("apps.assets.services.get_asset_storage", return_value=self.storage)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _read(self, customer=None, asset=None):
        return get_asset_bytes_for_customer(customer or self.customer, (asset or self.asset).id)

    def test_without_a_cache_block_every_read_goes_to_storage(self):
        """The default is unchanged — the cache is strictly opt-in per request."""
        self._read()
        self._read()
        self.assertEqual(len(self.storage.downloads), 2)

    def test_inside_a_block_each_photo_is_read_from_storage_once(self):
        with asset_bytes_cache():
            first = self._read()
            second = self._read()
            third = self._read()

        self.assertEqual(first, (b"photo-bytes", "image/png"))
        self.assertEqual(first, second)
        self.assertEqual(second, third)
        self.assertEqual(len(self.storage.downloads), 1)

    def test_a_repeat_read_costs_no_database_query_either(self):
        with asset_bytes_cache():
            self._read()
            with self.assertNumQueries(0):
                self._read()

    def test_distinct_photos_are_each_read_once(self):
        other = make_asset(customer=self.customer, status=Asset.STATUS_UPLOADED)
        with asset_bytes_cache():
            for _ in range(3):
                self._read()
                self._read(asset=other)

        self.assertEqual(len(self.storage.downloads), 2)

    def test_the_cache_never_hands_one_customers_photo_to_another(self):
        intruder = make_customer()
        with asset_bytes_cache():
            self._read()  # owner warms the cache
            with self.assertRaises(AssetAccessDenied):
                self._read(customer=intruder)

    def test_nothing_survives_the_block(self):
        """A later request must re-read: a replaced photo is never served
        from an old copy."""
        with asset_bytes_cache():
            self._read()
        with asset_bytes_cache():
            self._read()

        self.assertEqual(len(self.storage.downloads), 2)

    def test_it_works_as_a_decorator_and_starts_empty_on_every_call(self):
        @asset_bytes_cache()
        def two_reads():
            self._read()
            self._read()

        two_reads()
        two_reads()

        self.assertEqual(len(self.storage.downloads), 2)  # once per call, not once ever

    def test_exiting_a_nested_block_restores_the_outer_cache(self):
        with asset_bytes_cache():
            self._read()
            with asset_bytes_cache():
                self._read()  # inner starts empty
            self._read()  # outer is back, and still warm

        self.assertEqual(len(self.storage.downloads), 2)

    def test_an_unreadable_photo_still_raises_and_is_not_cached(self):
        calls = {"n": 0}

        def flaky(key):
            calls["n"] += 1
            if calls["n"] == 1:
                raise AssetStorageError("boom")
            return b"recovered"

        self.storage.download = flaky
        with asset_bytes_cache():
            with self.assertRaises(AssetDownloadFailed):
                self._read()
            self.assertEqual(self._read()[0], b"recovered")


class AssetBytesCacheBoundsTests(SimpleTestCase):
    def test_least_recently_used_entry_is_evicted_when_over_budget(self):
        cache = _AssetBytesCache(max_bytes=10)
        cache.put("a", (b"12345678", "x"))
        cache.put("b", (b"12345678", "x"))  # 16 > 10 -> "a" goes

        self.assertIsNone(cache.get("a"))
        self.assertIsNotNone(cache.get("b"))

    def test_a_single_oversize_photo_is_skipped_not_an_error(self):
        cache = _AssetBytesCache(max_bytes=10)
        cache.put("big", (b"x" * 20, "x"))

        self.assertIsNone(cache.get("big"))
