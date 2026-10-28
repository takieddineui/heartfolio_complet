"""
Storage abstraction for asset binaries. The rest of the application
(`apps/assets/services.py`) depends only on `AssetStorage` — never on
`boto3` directly — so swapping `MockAssetStorage` for `R2Storage` (which
this settings-driven `get_asset_storage()` factory does automatically
based on `settings.ASSET_STORAGE_BACKEND`) requires no changes to
business logic.

Cloudflare R2 exposes an S3-compatible API, so `R2Storage` is a thin
wrapper around `boto3`'s S3 client pointed at R2's endpoint — no
separate Cloudflare SDK.
"""

from __future__ import annotations

import contextvars
import logging
import time
from contextlib import contextmanager
from functools import lru_cache
from typing import BinaryIO, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

logger = logging.getLogger("heartfolio")

# SMALL ON PURPOSE. The attempt deadline can only be checked BETWEEN chunks,
# and a chunk read blocks until it is full. With 256KB chunks a connection
# crawling at a few KB/s took 64s to finish its first chunk — a real-socket
# test (tests_r2_stall.py) showed the 2s deadline being overshot 30x. At 16KB
# the overshoot is bounded by how long 16KB takes to arrive: ~0.2s at the
# slowest throughput measured against real R2 (~80KB/s), and a few seconds
# only on a connection that is already effectively dead.
_DOWNLOAD_CHUNK_BYTES = 16 * 1024


class AssetStorageError(Exception):
    """Raised for any failure talking to the storage backend. Deliberately
    generic — callers (apps/assets/services.py) translate this into the
    appropriate API error; this exception itself carries no R2-specific
    detail into application code, and its string form never includes
    credentials (see `R2Storage`'s use of `str(exc)` only for boto3's own
    already-credential-free error messages).
    """


class AssetStorage(Protocol):
    def upload(self, key: str, file_obj: BinaryIO, *, content_type: str) -> None: ...

    def delete(self, key: str) -> None: ...

    def generate_access_url(self, key: str, *, expires_in: int | None = None) -> str: ...

    def download(self, key: str) -> bytes: ...

    # For moving objects between keys (`move_assets_to_new_layout`). R2 has
    # no rename: a move is a server-side copy, a size check, and later a
    # delete of the original.
    def copy(self, source_key: str, target_key: str) -> None: ...

    def size(self, key: str) -> int | None: ...


# ONE SHARED CLOCK FOR EVERY READ IN A REQUEST. Per-attempt timeouts and a
# retry count bound a single photo, not the request: three attempts at a 45s
# deadline is 135s for ONE photo — past gunicorn's 120s worker kill, which is
# exactly the failure this module exists to prevent. Observed for real: R2
# degraded, a photo missed its deadline three times, and the request died at
# ~127s. `read_budget()` sets a monotonic deadline that every download in the
# block consults, across photos and retries, so a request ends — cleanly — well
# before the worker would have been killed.
_read_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar("r2_read_deadline", default=None)


@contextmanager
def read_budget(seconds: float | None):
    """Caps the total wall time storage reads inside this block may use,
    measured from now. `None`/0 means unbounded (the default outside a
    block). Worker threads do not inherit it automatically — submit work with
    `contextvars.copy_context().run(...)`."""
    previous = _read_deadline.get()
    _read_deadline.set(time.monotonic() + seconds if seconds else None)
    try:
        yield
    finally:
        _read_deadline.set(previous)  # not reset(): see `asset_bytes_cache`


def read_time_left() -> float | None:
    """Seconds left in the current `read_budget`, or None when unbounded."""
    deadline = _read_deadline.get()
    return None if deadline is None else deadline - time.monotonic()


class DownloadDeadlineExceeded(BotoCoreError):
    """One download attempt ran past `R2_DOWNLOAD_DEADLINE_SECONDS`. A
    `BotoCoreError` so it is retried exactly like boto's own timeouts."""

    fmt = "R2 download exceeded its {seconds}s deadline"


@lru_cache(maxsize=4)
def _s3_client(endpoint_url, access_key_id, secret_access_key, connect_timeout, read_timeout):
    """ONE client per distinct configuration, shared across `R2Storage`
    instances. `get_asset_storage()` builds a new `R2Storage` on every call,
    which used to mean a new boto3 client — and a fresh TLS handshake to R2 —
    for every single photo read. boto3 clients are thread-safe and keep a
    connection pool, so reusing one is both correct and what makes repeated
    reads cheap. Keyed on the values so a settings change gets a new client.
    """
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",  # R2 doesn't use AWS regions; "auto" is Cloudflare's documented value
        config=Config(
            connect_timeout=connect_timeout,
            read_timeout=read_timeout,
            # Covers the request phase (5xx, throttling, connect errors) with
            # boto's own backoff. Reading the BODY is not covered by boto's
            # retries at all — `R2Storage.download` retries that itself.
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


class R2Storage:
    """Real Cloudflare R2 storage via boto3's S3-compatible client."""

    def __init__(self):
        self._client = _s3_client(
            settings.R2_ENDPOINT_URL,
            settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY,
            settings.R2_CONNECT_TIMEOUT_SECONDS,
            settings.R2_READ_TIMEOUT_SECONDS,
        )
        self._bucket = settings.R2_BUCKET_NAME

    def upload(self, key: str, file_obj: BinaryIO, *, content_type: str) -> None:
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=file_obj,
                # The DETECTED type (§22a), never the client's claim and
                # never inferred from the filename.
                ContentType=content_type,
            )
            # NOT `ContentDisposition="attachment"`, and NOT a `nosniff`
            # entry in `Metadata` — both were tried and both are wrong here.
            #
            # `attachment` would force a download for every asset, breaking
            # the photographs in the Studio preview and the live keepsake,
            # and breaking video playback in the digital experience, which
            # is the entire point of §5's media.
            #
            # `Metadata` does not produce response headers. S3-compatible
            # storage returns custom metadata as `x-amz-meta-*`, so an entry
            # called "x-content-type-options" arrives as
            # `x-amz-meta-x-content-type-options` and no browser reads it.
            #
            # `X-Content-Type-Options: nosniff` is genuinely the mitigation
            # that matters for probe-only video, and it has to be configured
            # on the bucket or the CDN in front of it. Recorded as a
            # deployment step rather than pretended at here.
        except (BotoCoreError, ClientError) as exc:
            logger.error("r2_upload_failed", extra={"storage_key": key})
            raise AssetStorageError(f"R2 upload failed for key {key!r}: {exc}") from exc

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            logger.error("r2_delete_failed", extra={"storage_key": key})
            raise AssetStorageError(f"R2 delete failed for key {key!r}: {exc}") from exc

    def copy(self, source_key: str, target_key: str) -> None:
        """A server-side copy: the bytes never leave R2. The stored
        `ContentType` comes along (`MetadataDirective="COPY"`), so the copy
        is served exactly as the original was."""
        try:
            self._client.copy_object(
                Bucket=self._bucket,
                Key=target_key,
                CopySource={"Bucket": self._bucket, "Key": source_key},
                MetadataDirective="COPY",
            )
        except (BotoCoreError, ClientError) as exc:
            logger.error("r2_copy_failed", extra={"storage_key": source_key, "target_key": target_key})
            raise AssetStorageError(f"R2 copy failed for key {source_key!r}: {exc}") from exc

    def size(self, key: str) -> int | None:
        """The object's size in bytes, or None if there is no such object."""
        try:
            return int(self._client.head_object(Bucket=self._bucket, Key=key)["ContentLength"])
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            logger.error("r2_head_failed", extra={"storage_key": key})
            raise AssetStorageError(f"R2 head failed for key {key!r}: {exc}") from exc
        except BotoCoreError as exc:
            logger.error("r2_head_failed", extra={"storage_key": key})
            raise AssetStorageError(f"R2 head failed for key {key!r}: {exc}") from exc

    def generate_access_url(self, key: str, *, expires_in: int | None = None) -> str:
        # Public base URL is only used if the deployment intentionally
        # wants public read access (e.g. a CDN domain in front of the
        # bucket) — configured, never assumed. Otherwise every access
        # URL is a short-lived presigned GET, and nothing is ever
        # persisted to the database (see apps/assets/services.py).
        if settings.R2_PUBLIC_BASE_URL:
            return f"{settings.R2_PUBLIC_BASE_URL.rstrip('/')}/{key}"

        expires_in = expires_in or settings.R2_PRESIGNED_URL_EXPIRY_SECONDS
        try:
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=expires_in,
            )
        except (BotoCoreError, ClientError) as exc:
            logger.error("r2_presign_failed", extra={"storage_key": key})
            raise AssetStorageError(f"R2 presign failed for key {key!r}: {exc}") from exc

    def download(self, key: str) -> bytes:
        # Phase 3.9 addition: server-side compositing (e.g. the Love
        # Story Timeline PNG renderer pasting an event photo into the
        # generated output) needs the raw bytes back, not just a URL
        # for a browser to fetch. Nothing before Phase 3.9 needed this
        # — every prior use of assets was either an upload from the
        # browser or a presigned URL for the browser to fetch directly.
        #
        # A SLOW READ FAILS FAST AND IS RETRIED, rather than being waited on.
        # Measured against a real paid order, a 0.6MB read occasionally took
        # 17-87s, and the pack render makes many of them inside one request
        # whose worker is killed at 120s. A stalled or trickling read is
        # almost always a one-off, so abandoning it after the deadline and
        # asking again costs far less than waiting it out.
        #
        # Only `BotoCoreError`s are retried — socket timeouts, resets, short
        # reads (`IncompleteReadError`) and the deadline above. A
        # `ClientError` is R2 giving a definite answer (missing key, access
        # denied); asking again cannot change it.
        attempts = max(1, settings.R2_DOWNLOAD_ATTEMPTS)
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            left = read_time_left()
            # Out of request budget: stop. A further attempt needs at least
            # one idle-timeout of headroom to be able to finish or fail, and
            # the first attempt is only refused once the budget is gone.
            if left is not None and (left <= 0 or (attempt > 1 and left < settings.R2_READ_TIMEOUT_SECONDS)):
                logger.warning("r2_read_budget_exhausted", extra={"storage_key": key, "attempt": attempt})
                break
            try:
                response = self._client.get_object(Bucket=self._bucket, Key=key)
                deadline = settings.R2_DOWNLOAD_DEADLINE_SECONDS
                return self._read_body(response["Body"], deadline if left is None else min(deadline, left))
            except ClientError as exc:
                logger.error("r2_download_failed", extra={"storage_key": key})
                raise AssetStorageError(f"R2 download failed for key {key!r}: {exc}") from exc
            except BotoCoreError as exc:
                last_error = exc
                logger.warning(
                    "r2_download_retry",
                    extra={"storage_key": key, "attempt": attempt, "of": attempts, "reason": type(exc).__name__},
                )

        logger.error("r2_download_failed", extra={"storage_key": key})
        reason = last_error if last_error is not None else "the request's read budget was exhausted"
        raise AssetStorageError(f"R2 download failed for key {key!r}: {reason}") from last_error

    @staticmethod
    def _read_body(body, deadline_seconds: float) -> bytes:
        """Reads the response body in chunks so the attempt's total time can
        be checked between them — the socket's own READ timeout is an IDLE
        timeout and never fires on a connection that keeps trickling bytes.
        """
        deadline = time.monotonic() + deadline_seconds
        chunks: list[bytes] = []
        try:
            for chunk in body.iter_chunks(_DOWNLOAD_CHUNK_BYTES):
                chunks.append(chunk)
                if time.monotonic() > deadline:
                    raise DownloadDeadlineExceeded(seconds=deadline_seconds)
        except BaseException:
            body.close()
            raise
        return b"".join(chunks)


class MockAssetStorage:
    """In-memory storage — the default backend for local development
    (no R2 credentials required) and for the test suite. Never used in
    production (see config/settings/production.py, which refuses to
    start with ASSET_STORAGE_BACKEND=mock).
    """

    def __init__(self):
        self._objects: dict[str, bytes] = {}

    def upload(self, key: str, file_obj: BinaryIO, *, content_type: str) -> None:
        file_obj.seek(0)
        self._objects[key] = file_obj.read()

    def delete(self, key: str) -> None:
        self._objects.pop(key, None)

    def generate_access_url(self, key: str, *, expires_in: int | None = None) -> str:
        return f"mock://assets/{key}"

    def copy(self, source_key: str, target_key: str) -> None:
        try:
            self._objects[target_key] = self._objects[source_key]
        except KeyError as exc:
            raise AssetStorageError(f"No mock object found for key {source_key!r}") from exc

    def size(self, key: str) -> int | None:
        data = self._objects.get(key)
        return None if data is None else len(data)

    def exists(self, key: str) -> bool:
        """Test-only convenience, not part of the `AssetStorage`
        protocol other backends must implement.
        """
        return key in self._objects

    def download(self, key: str) -> bytes:
        try:
            return self._objects[key]
        except KeyError as exc:
            raise AssetStorageError(f"No mock object found for key {key!r}") from exc


_mock_storage_singleton: MockAssetStorage | None = None


def get_asset_storage() -> AssetStorage:
    """Factory selecting the storage backend from
    `settings.ASSET_STORAGE_BACKEND`. `MockAssetStorage` is returned as
    a process-wide singleton so uploads and later reads/deletes in the
    same process see the same in-memory object store (real R2 obviously
    doesn't need this — `R2Storage` is stateless, and the boto3 client
    behind it is shared per configuration by `_s3_client`).
    """
    if settings.ASSET_STORAGE_BACKEND == "r2":
        return R2Storage()

    global _mock_storage_singleton
    if _mock_storage_singleton is None:
        _mock_storage_singleton = MockAssetStorage()
    return _mock_storage_singleton
