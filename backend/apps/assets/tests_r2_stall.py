"""
Real-socket proof that a stalled R2 read recovers.

`tests_read_resilience.py` covers the retry logic with fakes. That proves the
code paths exist, not that a real stalled connection ever reaches them — a
`ReadTimeoutError` raised by a mock is not a socket going quiet. These tests
run the REAL boto3 client, real sockets, real timeouts and the real retry
loop against a local S3-compatible server that misbehaves on a script, then
behaves. No R2, no network, no real data involved.

Timeouts are shrunk (1s idle, 2s deadline) only so the suite stays fast; the
mechanisms are the production ones.
"""

import io
import os
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from apps.assets.models import Asset
from apps.assets.services import get_asset_bytes_for_customer
from apps.assets.storage import AssetStorageError, R2Storage, _s3_client, read_budget, read_time_left
from apps.commerce.order_access import generate_order_access_token
from apps.delivery.renderers import TemporaryFileResult
from apps.delivery.tests import make_delivery_pack, make_paid_order_with_entitlements, make_product

from .tests import make_asset


def _noise_png() -> bytes:
    """~480KB — incompressible, so the body spans more than one read chunk
    and 'half the body' is a real mid-stream position."""
    buffer = io.BytesIO()
    Image.frombytes("RGB", (400, 400), os.urandom(400 * 400 * 3)).save(buffer, format="PNG")
    return buffer.getvalue()


class FakeR2:
    """A local S3-compatible endpoint that serves one object and
    misbehaves per request according to `script`, then serves normally.

    Modes:
      stall_before_headers  accept, then never answer (a hung connection)
      stall_mid_body        send headers + half the body, then go silent
      trickle               send 1KB every 0.25s (alive, but crawling)
      reset_mid_body        send headers + half the body, then hang up
      ok                    serve the whole object
    """

    def __init__(self, payload: bytes, script=(), latency: float = 0.0):
        self.payload = payload
        self.latency = latency
        self._script = list(script)
        self._lock = threading.Lock()
        self._release = threading.Event()
        self.served: list[str] = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_GET(self):
                fake._handle(self)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"

    def start(self):
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self._release.set()  # wake anything stalled so shutdown is prompt
        self._server.shutdown()
        self._server.server_close()

    def _next_mode(self) -> str:
        with self._lock:
            mode = self._script.pop(0) if self._script else "ok"
            self.served.append(mode)
            return mode

    def _handle(self, handler):
        mode = self._next_mode()
        size = len(self.payload)
        if self.latency:
            self._release.wait(self.latency)  # every response is slow, like a high-latency link

        if mode == "stall_before_headers":
            self._release.wait(30)
            handler.close_connection = True
            return

        handler.send_response(200)
        handler.send_header("Content-Type", "image/png")
        handler.send_header("Content-Length", str(size))
        handler.end_headers()
        try:
            if mode == "ok":
                handler.wfile.write(self.payload)
            elif mode == "stall_mid_body":
                handler.wfile.write(self.payload[: size // 2])
                handler.wfile.flush()
                self._release.wait(30)
            elif mode == "reset_mid_body":
                handler.wfile.write(self.payload[: size // 2])
                handler.wfile.flush()
            elif mode == "trickle":
                for start in range(0, size, 1024):
                    handler.wfile.write(self.payload[start : start + 1024])
                    handler.wfile.flush()
                    if self._release.wait(0.25):
                        break
        except (BrokenPipeError, ConnectionResetError):
            pass
        handler.close_connection = True


class _FakeR2Case(TestCase):
    """Boots a FakeR2 per test and points the real R2 client at it."""

    script: tuple = ()
    latency: float = 0.0

    def setUp(self):
        self.payload = _noise_png()
        self.fake = FakeR2(self.payload, self.script, self.latency).start()
        self.addCleanup(self.fake.stop)

        _s3_client.cache_clear()
        self.addCleanup(_s3_client.cache_clear)

        overrides = override_settings(
            ASSET_STORAGE_BACKEND="r2",
            R2_ENDPOINT_URL=self.fake.url,
            R2_ACCESS_KEY_ID="test",
            R2_SECRET_ACCESS_KEY="test",
            R2_BUCKET_NAME="bucket",
            R2_CONNECT_TIMEOUT_SECONDS=1,
            R2_READ_TIMEOUT_SECONDS=1,
            R2_DOWNLOAD_DEADLINE_SECONDS=2,
            R2_DOWNLOAD_ATTEMPTS=3,
        )
        overrides.enable()
        self.addCleanup(overrides.disable)

    def timed_download(self):
        started = time.monotonic()
        data = R2Storage().download("assets/photo.png")
        return data, time.monotonic() - started


class StalledReadRecoveryTests(_FakeR2Case):
    def test_a_healthy_read_is_untouched(self):
        data, elapsed = self.timed_download()
        self.assertEqual(data, self.payload)
        self.assertEqual(self.fake.served, ["ok"])

    def test_a_connection_that_goes_silent_mid_body_is_abandoned_and_retried(self):
        self.fake._script[:] = ["stall_mid_body"]
        data, elapsed = self.timed_download()

        self.assertEqual(data, self.payload)  # whole and correct, not the half it saw first
        self.assertEqual(self.fake.served, ["stall_mid_body", "ok"])
        self.assertLess(elapsed, 8, "should cost about one idle timeout, not the length of the stall")

    def test_a_connection_that_never_answers_is_abandoned_and_retried(self):
        self.fake._script[:] = ["stall_before_headers"]
        data, elapsed = self.timed_download()

        self.assertEqual(data, self.payload)
        self.assertEqual(self.fake.served, ["stall_before_headers", "ok"])
        self.assertLess(elapsed, 8)

    def test_a_connection_that_hangs_up_mid_body_is_retried(self):
        self.fake._script[:] = ["reset_mid_body"]
        data, elapsed = self.timed_download()

        self.assertEqual(data, self.payload)
        self.assertEqual(self.fake.served, ["reset_mid_body", "ok"])

    def test_a_read_that_crawls_but_never_goes_idle_hits_the_deadline(self):
        """Bytes keep arriving, so the idle timeout never fires. Only the
        overall deadline catches this — and only if it is checked often
        enough: it is checked between chunks, so the chunk has to be small
        relative to the crawl."""
        self.fake._script[:] = ["trickle"]
        data, elapsed = self.timed_download()

        self.assertEqual(data, self.payload)
        self.assertEqual(self.fake.served, ["trickle", "ok"])
        self.assertLess(elapsed, 12, "the deadline is 2s; a crawl must not be waited out")

    def test_two_stalls_in_a_row_still_recover_on_the_third_attempt(self):
        self.fake._script[:] = ["stall_mid_body", "reset_mid_body"]
        data, _ = self.timed_download()

        self.assertEqual(data, self.payload)
        self.assertEqual(self.fake.served, ["stall_mid_body", "reset_mid_body", "ok"])


class WithoutRetriesTheSameStallFailsTests(_FakeR2Case):
    """The control: proves it is the retry that rescues the download, not
    the stall being mild."""

    script = ("stall_mid_body",)

    def test_a_single_attempt_does_not_survive_one_stall(self):
        with override_settings(R2_DOWNLOAD_ATTEMPTS=1), self.assertRaises(AssetStorageError):
            R2Storage().download("assets/photo.png")


class PersistentStallTests(_FakeR2Case):
    script = ("stall_mid_body",) * 20

    def test_a_connection_that_never_recovers_fails_promptly_and_cleanly(self):
        started = time.monotonic()
        with self.assertRaises(AssetStorageError):
            R2Storage().download("assets/photo.png")
        elapsed = time.monotonic() - started

        self.assertEqual(self.fake.served.count("stall_mid_body"), 3)  # attempts, not unbounded
        self.assertLess(elapsed, 15, "3 attempts x ~1s idle timeout, nowhere near the 120s worker limit")


class StalledPackDownloadTests(_FakeR2Case):
    """End to end through the real view: a Printable pack whose photo read
    stalls once still produces a complete, valid zip."""

    script = ("stall_mid_body",)
    PRINT_TARGETS = ["print-a4-frameless", "print-a4-edged", "print-classic-frameless", "print-classic-edged"]

    def test_the_pack_zip_survives_a_stalled_photo_read(self):
        product = make_product()
        pack = make_delivery_pack(product=product, slug="printable", included_targets=self.PRINT_TARGETS)
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=self.PRINT_TARGETS, product=product, delivery_pack=pack
        )
        photo = make_asset(
            customer=customer, mime_type="image/png", status=Asset.STATUS_UPLOADED, storage_key="assets/photo.png"
        )

        class _PhotoRenderer:
            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                data, _mime = get_asset_bytes_for_customer(customer, photo.id)
                return TemporaryFileResult(content=data, content_type="image/png", filename=f"{target_id}.png")

        token = generate_order_access_token(order.id)
        started = time.monotonic()
        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: _PhotoRenderer()}):
            response = APIClient().get(f"/api/v1/orders/{order.id}/download/printable/{token}/")
        elapsed = time.monotonic() - started

        self.assertEqual(response.status_code, 200)
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        self.assertIsNone(archive.testzip())
        self.assertEqual(len([n for n in archive.namelist() if n.endswith(".png")]), len(self.PRINT_TARGETS))
        # One stalled request + one good one, for four renders: the retry
        # happened once and the photo cache absorbed the other three reads.
        self.assertEqual(self.fake.served, ["stall_mid_body", "ok"])
        self.assertLess(elapsed, 15)


class RequestReadBudgetTests(_FakeR2Case):
    """Per-attempt deadlines bound ONE photo; the request budget bounds the
    request. Found for real: with R2 degraded, one photo burned three 45s
    attempts (~127s) and the request outlived gunicorn's 120s worker timeout.
    """

    script = ("stall_mid_body",) * 30

    def test_the_budget_stops_retrying_long_before_the_attempts_run_out(self):
        started = time.monotonic()
        with override_settings(R2_DOWNLOAD_ATTEMPTS=10), read_budget(2.5):
            with self.assertRaises(AssetStorageError):
                R2Storage().download("assets/photo.png")
        elapsed = time.monotonic() - started

        # ~1s per stalled attempt: the 3rd would start with <1s left, so it is not started.
        self.assertLessEqual(len(self.fake.served), 3)
        self.assertLess(elapsed, 5, "10 attempts would have taken ~10s")

    def test_an_exhausted_budget_does_not_even_start_a_read(self):
        with read_budget(0.05):
            time.sleep(0.1)
            with self.assertRaises(AssetStorageError):
                R2Storage().download("assets/photo.png")

        self.assertEqual(self.fake.served, [])

    def test_the_budget_is_shared_across_reads_not_per_read(self):
        """Two photos in one request draw on the same clock."""
        started = time.monotonic()
        with override_settings(R2_DOWNLOAD_ATTEMPTS=10), read_budget(2.5):
            for _ in range(2):
                with self.assertRaises(AssetStorageError):
                    R2Storage().download("assets/photo.png")
        elapsed = time.monotonic() - started

        self.assertLess(elapsed, 5, "a per-read budget would allow ~2 x 2.5s of retries, plus stalls")

    def test_a_healthy_read_inside_a_budget_is_unaffected(self):
        self.fake._script[:] = []
        with read_budget(30):
            self.assertEqual(R2Storage().download("assets/photo.png"), self.payload)

    def test_there_is_no_budget_outside_a_block(self):
        self.assertIsNone(read_time_left())
        with read_budget(30):
            self.assertGreater(read_time_left(), 25)
        self.assertIsNone(read_time_left())


class SlowLinkPrefetchTests(_FakeR2Case):
    """Controlled A/B through the real view, boto client and sockets: every
    R2 response takes 1.5s. Three photos read one after another cost ~4.5s;
    fetched together they cost ~1.5s. (Against live R2 the gap depends on how
    slow R2 is that minute — measured 63s sequential for a case where one read
    alone was 28s. Here it is deterministic.)"""

    latency = 1.5
    PRINT_TARGETS = ["print-a4-frameless", "print-a4-edged", "print-classic-frameless", "print-classic-edged"]

    def _order(self):
        product = make_product()
        pack = make_delivery_pack(product=product, slug="printable", included_targets=self.PRINT_TARGETS)
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=self.PRINT_TARGETS, product=product, delivery_pack=pack
        )
        photos = [
            make_asset(
                customer=customer, mime_type="image/png", status=Asset.STATUS_UPLOADED,
                storage_key=f"assets/{uuid.uuid4().hex}-{i}.png",
            )
            for i in range(3)
        ]
        order.project.data = {
            "version": 1,
            "values": {"events": [{"photo": {"assetId": str(p.id)}} for p in photos]},
            "themeSelections": {},
        }
        order.project.save()

        class _PhotosRenderer:
            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                for photo in photos:
                    data, _mime = get_asset_bytes_for_customer(customer, photo.id)
                return TemporaryFileResult(content=data, content_type="image/png", filename=f"{target_id}.png")

        return order, product, _PhotosRenderer()

    def _timed_download(self, order, product, renderer):
        token = generate_order_access_token(order.id)
        started = time.monotonic()
        with patch.dict("apps.delivery.registry._REGISTRY", {product.slug: renderer}):
            response = APIClient().get(f"/api/v1/orders/{order.id}/download/printable/{token}/")
        elapsed = time.monotonic() - started
        self.assertEqual(response.status_code, 200)
        return elapsed, sorted(zipfile.ZipFile(io.BytesIO(response.content)).namelist())

    def test_three_slow_photos_cost_one_latency_not_three(self):
        with override_settings(R2_READ_TIMEOUT_SECONDS=10, R2_CONNECT_TIMEOUT_SECONDS=5, ASSET_READ_BUDGET_SECONDS=60):
            order, product, renderer = self._order()

            with patch("apps.delivery.views.prefetch_order_photos", return_value=0):  # OFF: sequential reads
                off, off_names = self._timed_download(order, product, renderer)
            off_requests = len(self.fake.served)

            on, on_names = self._timed_download(order, product, renderer)  # ON: concurrent warm-up
            on_requests = len(self.fake.served) - off_requests

        timings = f"sequential {off:.2f}s, concurrent {on:.2f}s"
        self.assertEqual(off_names, on_names)  # same archive either way
        self.assertEqual((off_requests, on_requests), (3, 3))  # each photo exactly once, both ways
        self.assertGreater(off, 4.0, f"sequential: 3 x 1.5s ({timings})")
        self.assertLess(on, 3.3, f"concurrent: ~1 x 1.5s ({timings})")
        self.assertLess(on, off - 1.5, timings)
