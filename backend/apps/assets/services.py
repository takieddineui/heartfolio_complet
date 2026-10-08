"""
Asset upload/retrieval/delete service functions. Storage-key generation
and file validation live here so `apps/assets/views.py` stays thin and
`apps/assets/storage.py` stays free of any business rule (allowed MIME
types, size limits, ownership).
"""

from __future__ import annotations

import contextvars
import logging
import os
import re
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError
from contextlib import contextmanager

import io

from apps.assets.media import AUDIO_MIME_TYPES, is_media, reencode_audio, validate_media
from PIL import Image, UnidentifiedImageError
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.conf import settings
from django.utils import timezone

#: §7 — how long a provisional (video/audio) asset survives before the
#: sweep deletes it, if no paid order has promoted it. Configurable via
#: settings rather than hardcoded, matching the pattern already used for
#: `MAX_MEDIA_SIZE_MB` and `MEDIA_REENCODE_TIMEOUT_SECONDS` in the same
#: settings module.
PROVISIONAL_MEDIA_RETENTION = settings.MEDIA_PROVISIONAL_RETENTION
from django.db import transaction

from apps.common.exceptions.api_errors import (
    AssetAccessDenied,
    AssetDeleteFailed,
    AssetDownloadFailed,
    AssetNotFound,
    AssetTooLarge,
    AssetUploadFailed,
    InvalidAssetType,
    MissingAssetFile,
)

from .models import Asset
from .storage import AssetStorageError, get_asset_storage, read_budget, read_time_left

logger = logging.getLogger("heartfolio")

_SAFE_FILENAME_CHARS_RE = re.compile(r"[^A-Za-z0-9._-]+")
_MAX_SAFE_FILENAME_LENGTH = 150


def _sanitize_filename(filename: str | None) -> str:
    """Strips any directory component and anything outside a small safe
    character set. Defeats path traversal (`../../etc/passwd`,
    `C:\\Windows\\...`, `/etc/passwd`) regardless of which OS's path
    separators the client sends, since `os.path.basename` only strips
    forward slashes and the regex substitution afterward removes
    backslashes (and everything else non-safe) too.
    """
    base = os.path.basename(filename or "")
    safe = _SAFE_FILENAME_CHARS_RE.sub("_", base).strip("._")
    return (safe or "file")[:_MAX_SAFE_FILENAME_LENGTH]


def generate_storage_key(asset_id, filename: str | None) -> str:
    """Server-generated, collision-resistant, not user-controlled: the
    asset's own UUID is the stable identifying path segment, and the
    (sanitized) original filename is included only for readability in
    the R2 console — it plays no role in uniqueness or lookup.
    """
    return f"assets/{asset_id}/{_sanitize_filename(filename)}"


#: Pillow's format name -> the MIME type we store and serve it as.
#: Deliberately narrow: only the three formats `ALLOWED_ASSET_MIME_TYPES`
#: permits. Pillow can decode dozens more, and a format absent from this map
#: is rejected even if it decodes perfectly.
_PILLOW_FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}

#: The reverse, for re-encoding. Derived rather than written out twice, so
#: adding a supported format cannot leave the two halves disagreeing.
_MIME_TO_PILLOW_FORMAT = {mime: fmt for fmt, mime in _PILLOW_FORMAT_TO_MIME.items()}


def detect_image_mime_type(uploaded_file) -> str:
    """Opens the file and returns the MIME type its *bytes* say it is (§22a).

    WHY THIS EXISTS. The checks above read `uploaded_file.content_type`,
    which is a header the client sends and can set to anything. A file
    renamed from `payload.bin` to `photo.png`, or posted with a forged
    `Content-Type`, passed every check and went straight to storage — and
    was then served back with the MIME type the client had claimed. Nothing
    ever opened it to see whether it was an image at all.

    So the format is taken from the decode, not from the request, and it is
    the detected type that gets stored and served. Serving bytes under a
    Content-Type that contradicts them is precisely what content-sniffing
    attacks rely on.

    `verify()` rather than a full decode: it walks the file's structure and
    raises on anything malformed, without paying to rasterize an image the
    server has no reason to rasterize. It also consumes the file object,
    which is why the caller must seek back to the start afterwards — done
    below, not left to the caller to remember.
    """
    try:
        uploaded_file.seek(0)
        with Image.open(uploaded_file) as image:
            detected_format = image.format
            image.verify()
    except Image.DecompressionBombError:
        # A small file that expands to an enormous bitmap. Pillow guards
        # this at ~89 megapixels by default. Rejected as a size problem
        # rather than a type problem, because that is what it is — the file
        # passed the byte-size check by being compressed.
        raise AssetTooLarge("Image dimensions are too large to process.")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        # Pillow raises a spread of exception types for malformed input
        # depending on how far it got. All of them mean the same thing here.
        raise InvalidAssetType("File is not a valid image.")
    finally:
        # `verify()` leaves the file consumed; the upload that follows must
        # still see it from byte zero.
        try:
            uploaded_file.seek(0)
        except (AttributeError, OSError):  # pragma: no cover - non-seekable
            pass

    mime_type = _PILLOW_FORMAT_TO_MIME.get(detected_format or "")
    if mime_type is None or mime_type not in settings.ALLOWED_ASSET_MIME_TYPES:
        raise InvalidAssetType(f"'{detected_format or 'unknown'}' is not a supported image format.")

    return mime_type


def sanitize_image(uploaded_file, mime_type: str) -> ContentFile:
    """Rewrites an upload from its pixel data alone (§22c).

    §22c asks for malware/content scanning and calls it optional
    defence-in-depth, noting the blast radius is limited because uploads are
    only ever consumed by Heartfolio's own Pillow renderer.

    This is a different answer to that requirement, and in this context a
    better one than a scanner. The file is decoded and a fresh image is
    written from the resulting pixels. Nothing that is not pixel data
    survives, because nothing else is copied:

      * appended payloads after the image data — dropped
      * polyglot files that are a valid image AND a valid archive or script
        depending on the reader — the second identity is gone
      * malformed or hostile chunks aimed at a specific decoder
      * embedded scripts in metadata

    WHY NOT A VIRUS SCANNER. A third-party API would mean uploading
    customers' photographs — often intimate ones — to another company for
    analysis, on a product whose entire premise is personal memories. Self-
    hosted ClamAV avoids that but needs a daemon, roughly a gigabyte of
    signatures and perpetual definition updates. Re-encoding needs none of
    those and defends against tomorrow's payload rather than yesterday's
    signature.

    WHAT IT DOES NOT DO, stated plainly: it will not detect a genuine,
    well-formed image that is malware bait for some *other* decoder further
    down a chain. That chain does not exist here — §22c says so — but if a
    customer's file is ever handed to a third party, this is not the control
    that covers it.

    EXIF IS STRIPPED as a consequence, and that is a privacy improvement
    worth having on its own: phone photographs carry GPS coordinates, and a
    keepsake product had no reason to be storing where its customers live.

    Format is preserved so the stored `mime_type` stays truthful. JPEG is
    re-encoded at high quality; PNG and WebP are lossless, so the only thing
    lost is what was never image data.
    """
    uploaded_file.seek(0)
    with Image.open(uploaded_file) as image:
        # `load()` forces a full decode. `Image.open` is lazy, and a file
        # that only fails partway through decoding would otherwise reach the
        # save below and produce a truncated image rather than an error.
        image.load()

        target_format = _MIME_TO_PILLOW_FORMAT[mime_type]

        # A palette or alpha-bearing image saved as JPEG raises; converting
        # only where the target demands it avoids touching PNG/WebP alpha,
        # which customers legitimately use for cut-out photos.
        if target_format == "JPEG" and image.mode not in ("RGB", "L"):
            image = image.convert("RGB")

        buffer = io.BytesIO()
        save_options: dict = {"format": target_format}
        if target_format == "JPEG":
            save_options.update(quality=92, optimize=True, progressive=True)
        elif target_format == "WEBP":
            save_options.update(quality=92, method=4)

        # No `exif=` and no `pnginfo=` argument: metadata is dropped by
        # omission rather than by an explicit strip, which is the harder
        # thing to get wrong.
        image.save(buffer, **save_options)

    buffer.seek(0)
    return ContentFile(buffer.read(), name=getattr(uploaded_file, "name", "upload"))


def validate_uploaded_file(uploaded_file) -> str:
    """Validates and returns the DETECTED MIME type, which the caller should
    store rather than the client-declared one."""
    if uploaded_file is None:
        raise MissingAssetFile()

    # Cheap checks first — a wrong declared type or an oversized file is
    # rejected without ever handing bytes to an image decoder.
    content_type = getattr(uploaded_file, "content_type", None)
    if content_type not in settings.ALLOWED_ASSET_MIME_TYPES:
        raise InvalidAssetType(f"'{content_type}' is not a supported file type.")

    # §5 — the ceiling depends on the KIND. Applying the image limit to
    # video would reject three seconds of phone footage; applying the media
    # limit to images would let someone store 50MB of PNG per milestone.
    #
    # Keyed on the DECLARED type here because nothing has been read yet, and
    # this is the cheap gate — the declared type is then verified below, so
    # a video declared as an image is rejected by the image detector rather
    # than sneaking through on the smaller limit.
    limit_mb = settings.MAX_MEDIA_SIZE_MB if is_media(content_type) else settings.MAX_ASSET_SIZE_MB
    if uploaded_file.size > limit_mb * 1024 * 1024:
        raise AssetTooLarge(f"File exceeds the maximum allowed size of {limit_mb}MB.")

    if is_media(content_type):
        # Media is not an image; `detect_image_mime_type` would reject it.
        # The real verification happens in `validate_media`, which reads the
        # streams rather than trusting the declared type.
        return content_type

    return detect_image_mime_type(uploaded_file)


def upload_asset(customer, uploaded_file) -> Asset:
    """Create-pending -> upload-to-storage -> mark-uploaded, with
    cleanup on failure. An uploaded file always belongs to the
    customer performing the upload — there is no anonymous/unowned
    upload path in this API (see the module docstring in models.py for
    the one case `customer` can be NULL: an owning customer later
    deleted, handled by the DB's ON DELETE SET NULL — not something
    this endpoint ever creates directly).
    """
    # The detected type, not the declared one — see `detect_image_mime_type`.
    mime_type = validate_uploaded_file(uploaded_file)

    # §5 — media takes a different path from images.
    #
    # Audio is re-encoded like an image, so it keeps the same guarantee.
    # Video is probed and stored as-received, which is weaker and was a
    # deliberate decision — see the module docstring in assets/media.py for
    # exactly what that leaves open.
    if is_media(mime_type):
        validate_media(uploaded_file, mime_type)
        if mime_type in AUDIO_MIME_TYPES:
            uploaded_file = reencode_audio(uploaded_file)
            mime_type = "audio/mp4"
    else:

        # §22c — everything stored from here on is the re-encoded file,
        # never the bytes the customer sent.
        #
        # After validation, so a file that was going to be rejected is
        # never decoded a second time, and so `mime_type` is already known
        # and trustworthy — re-encoding needs a target format and taking it
        # from the client's claim rather than the detected one would defeat
        # §22a.
        uploaded_file = sanitize_image(uploaded_file, mime_type)

    # Generate the id up front so the real storage_key can be included
    # in the single INSERT below — creating the row first with a
    # placeholder key and updating it afterward would open a window
    # where two concurrent uploads could both insert the same
    # (storage_provider, storage_key) placeholder and collide on the
    # unique constraint.
    asset_id = uuid.uuid4()
    storage_key = generate_storage_key(asset_id, uploaded_file.name)

    asset = Asset.objects.create(
        id=asset_id,
        customer=customer,
        storage_provider="r2",
        storage_key=storage_key,
        original_filename=uploaded_file.name,
        mime_type=mime_type,
        status=Asset.STATUS_PENDING,
        # §7 — provisional for video/audio only. Photos are needed by
        # every pack including Printable-only, so there is nothing to
        # defer and no reason to risk one disappearing from an active
        # project; video/audio are only needed by Digital, AR or Complete,
        # and most uploads of them are never purchased at all, which is
        # the actual cost this bounds.
        expires_at=(timezone.now() + PROVISIONAL_MEDIA_RETENTION) if is_media(mime_type) else None,
    )

    storage = get_asset_storage()
    try:
        storage.upload(asset.storage_key, uploaded_file, content_type=mime_type)
    except AssetStorageError:
        # Do not leave an `uploaded` row when the object was never
        # actually created in storage — mark it failed instead, so a
        # broken/partial asset never appears indistinguishable from a
        # real one, and the row remains as a diagnostic record rather
        # than vanishing.
        asset.status = Asset.STATUS_FAILED
        asset.save(update_fields=["status", "updated_at"])
        raise AssetUploadFailed()

    asset.status = Asset.STATUS_UPLOADED
    asset.save(update_fields=["status", "updated_at"])
    return asset


def get_asset_for_customer(customer, asset_id) -> Asset:
    """Ownership check in one place, mirroring
    `projects.services.get_project_for_customer` /
    `commerce.services.get_order_for_customer`. A soft-deleted asset
    (`status="deleted"`) is treated as not-found — deletion is final
    from the API's perspective even though the row itself survives.

    `ValidationError` is caught alongside `ValueError`/`TypeError`: a
    malformed UUID string raises Django's own `ValidationError` from the
    field's `to_python`, not a bare `ValueError` — the same split
    `ar_views.py`'s own `_LOOKUP_FAILURES` already documents and guards
    against for the same reason. Missing it here let a non-UUID asset id
    escape as an uncaught 500 instead of the same `AssetNotFound` every
    other malformed-id shape already produces.
    """
    try:
        asset = Asset.objects.get(id=asset_id)
    except (Asset.DoesNotExist, ValidationError, ValueError, TypeError):
        raise AssetNotFound()

    if asset.status == Asset.STATUS_DELETED:
        raise AssetNotFound()

    if asset.customer_id != customer.id:
        raise AssetAccessDenied()

    return asset


def generate_asset_access_url(asset: Asset) -> str:
    """Computed fresh on every call — never persisted (see
    apps/assets/storage.py and the Phase 3.5 report: the database
    stores `storage_key`, never a presigned URL).
    """
    storage = get_asset_storage()
    return storage.generate_access_url(asset.storage_key)


def delete_asset(customer, asset_id) -> None:
    """Ownership-checked delete. Ordering is deliberate: the R2 object
    is deleted *before* the database is updated.

    - If the R2 delete fails, the exception propagates
      (`AssetDeleteFailed`) and the `Asset` row is left completely
      untouched — still `uploaded`, still pointing at an object that
      (as far as we know) still exists in R2. The operation is safely
      retryable and no data is silently lost.
    - If the R2 delete succeeds but the subsequent DB update fails
      (e.g. a database connectivity blip), the object is genuinely gone
      from R2 but the row could be left claiming otherwise. This MVP
      does not implement a distributed transaction or a reconciliation
      job for that narrow window — it's an accepted, documented
      limitation (see the Phase 3.5 report), not something silently
      pretended away.
    """
    asset = get_asset_for_customer(customer, asset_id)

    storage = get_asset_storage()
    try:
        storage.delete(asset.storage_key)
    except AssetStorageError:
        raise AssetDeleteFailed()

    with transaction.atomic():
        asset.status = Asset.STATUS_DELETED
        asset.save(update_fields=["status", "updated_at"])


class _AssetBytesCache:
    """Byte-bounded LRU of `(customer id, asset id) -> (bytes, mime type)`.

    Only ever lives for the duration of one `asset_bytes_cache()` block —
    i.e. one download request — so it never serves stale or cross-request
    data, and it is bounded because a pack render holds large canvases in
    memory at the same time (see `OrderPackDownloadView`'s memory notes).
    """

    def __init__(self, max_bytes: int) -> None:
        self._max_bytes = max_bytes
        self._size = 0
        self._entries: OrderedDict[tuple, tuple[bytes, str]] = OrderedDict()

    def get(self, key):
        entry = self._entries.get(key)
        if entry is not None:
            self._entries.move_to_end(key)
        return entry

    def put(self, key, entry: tuple[bytes, str]) -> None:
        size = len(entry[0])
        if size > self._max_bytes or key in self._entries:
            return  # one oversize photo is simply not cached, never an error
        self._entries[key] = entry
        self._size += size
        while self._size > self._max_bytes:
            _, (evicted, _mime) = self._entries.popitem(last=False)
            self._size -= len(evicted)

    def put_if_room(self, key, entry: tuple[bytes, str]) -> bool:
        """Like `put`, but never evicts. Used by the up-front warm-up, where
        evicting a photo to make room for the next would only mean fetching
        the first one again."""
        size = len(entry[0])
        if key in self._entries or self._size + size > self._max_bytes:
            return False
        self._entries[key] = entry
        self._size += size
        return True


_active_bytes_cache: contextvars.ContextVar[_AssetBytesCache | None] = contextvars.ContextVar(
    "asset_bytes_cache", default=None
)


@contextmanager
def asset_bytes_cache(max_bytes: int | None = None):
    """Within this block, `get_asset_bytes_for_customer` reads each photo
    from storage ONCE and serves repeats from memory.

    WHY: a pack renders one file per print size and mounting, and every one
    of them pasted the same few photos by fetching them from R2 again — a
    Printable pack read 3 distinct photos 18 times. Measured against a real
    paid order, ~90% of the render's wall time was spent waiting on those
    reads, and the request is killed at gunicorn's 120s timeout.

    Scoped to a block rather than process-wide on purpose: it is opened by
    the download views for the length of one request, so nothing is shared
    between requests or customers and a replaced photo is never served from
    an old copy. Outside any block `get_asset_bytes_for_customer` behaves
    exactly as before — nothing else needs to know this exists.

    Also usable as a decorator (`@asset_bytes_cache()`); the cache is
    created fresh on every call, not at decoration time.
    """
    if max_bytes is None:
        max_bytes = settings.ASSET_BYTES_CACHE_MAX_MB * 1024 * 1024
    previous = _active_bytes_cache.get()
    _active_bytes_cache.set(_AssetBytesCache(max_bytes))
    try:
        # The same block is one request's worth of storage reads, so it also
        # opens that request's read budget: every download inside — across
        # photos and retries — shares ONE clock that runs out well before
        # gunicorn's 120s worker kill. See `storage.read_budget`.
        with read_budget(settings.ASSET_READ_BUDGET_SECONDS):
            yield
    finally:
        # `set(previous)` rather than `reset(token)`: `reset` raises if the
        # block is exited from a different context than it was entered in,
        # which a generator-based streaming response can legitimately do.
        _active_bytes_cache.set(previous)


def get_asset_bytes_for_customer(customer, asset_id) -> tuple[bytes, str]:
    """Ownership-checked read of an input asset's raw bytes (plus its
    real, stored MIME type) — added in Phase 3.9 for server-side
    compositing (a product renderer pasting/embedding a customer's
    uploaded photo into generated output). Never accepts a
    client-supplied storage key: the key always comes from the
    ownership-verified `Asset` row itself, via `get_asset_for_customer`.

    Inside an `asset_bytes_cache()` block a repeat read of the same asset
    for the same customer is served from memory. The ownership check ran
    on the first read and its answer cannot change within one request, and
    the key includes the customer id, so a cache hit never crosses
    customers.
    """
    cache = _active_bytes_cache.get()
    cache_key = (customer.id, str(asset_id))
    if cache is not None:
        hit = cache.get(cache_key)
        if hit is not None:
            return hit

    asset = get_asset_for_customer(customer, asset_id)
    storage = get_asset_storage()
    try:
        result = (storage.download(asset.storage_key), asset.mime_type)
    except AssetStorageError:
        raise AssetDownloadFailed()

    if cache is not None:
        cache.put(cache_key, result)
    return result


def prefetch_asset_bytes(customer, asset_ids) -> int:
    """Warms the active `asset_bytes_cache()` by reading several photos from
    storage AT THE SAME TIME. Returns how many it warmed.

    WHY: with de-duplication a pack still read its distinct photos one after
    another, so a render cost the SUM of their R2 latencies. Measured against
    real R2, three photos took 63s that way (one read alone took 28s); fetched
    together the render waits only for the slowest.

    A WARM-UP, NEVER A DEPENDENCY. Everything it skips or fails on is read on
    demand by `get_asset_bytes_for_customer` exactly as before, so the worst
    outcome of this function is that it did nothing. It therefore never
    raises, and:

    - it does nothing outside an `asset_bytes_cache()` block;
    - it does nothing for fewer than two distinct photos — the common case
      has no reason to pay for a thread pool, and then touches the database
      and storage not at all;
    - ownership is checked HERE, on the request thread, by the same
      `get_asset_for_customer` the normal path uses; an asset that is missing
      or not the customer's is skipped, and the real read raises its own
      proper error later;
    - ONLY the storage download runs in worker threads. Django connections
      are per-thread, and this project's database is a session-mode pooler,
      so a thread touching the ORM would open (and have to close) a pooler
      session per photo;
    - it never evicts (`put_if_room`), and stops waiting after
      `ASSET_PREFETCH_BUDGET_SECONDS` so a bad read cannot hold the request
      past what the on-demand path would have taken.
    """
    cache = _active_bytes_cache.get()
    if cache is None:
        return 0

    try:
        distinct = list(dict.fromkeys(str(asset_id) for asset_id in asset_ids))
        if len(distinct) < 2:
            return 0

        wanted = []
        for asset_id in distinct:
            key = (customer.id, asset_id)
            if cache.get(key) is not None:
                continue
            try:
                wanted.append((key, get_asset_for_customer(customer, asset_id)))
            except (AssetNotFound, AssetAccessDenied):
                continue
        if len(wanted) < 2:
            return 0

        storage = get_asset_storage()
        workers = max(1, min(settings.ASSET_PREFETCH_WORKERS, len(wanted)))
        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="asset-prefetch")
        # Each worker runs in a COPY of this context so it sees the request's
        # read budget (threads start with an empty context otherwise). One
        # copy per task: a Context cannot be entered by two threads at once.
        futures = {
            executor.submit(contextvars.copy_context().run, storage.download, asset.storage_key): (key, asset)
            for key, asset in wanted
        }

        budget = settings.ASSET_PREFETCH_BUDGET_SECONDS
        left = read_time_left()
        if left is not None:
            budget = max(0, min(budget, left))

        warmed = 0
        try:
            for future in as_completed(futures, timeout=budget):
                key, asset = futures[future]
                try:
                    data = future.result()
                except Exception:  # noqa: BLE001 - the on-demand read will retry and raise properly
                    logger.warning("asset_prefetch_miss", extra={"asset_id": key[1]})
                    continue
                if cache.put_if_room(key, (data, asset.mime_type)):
                    warmed += 1
        except FuturesTimeoutError:
            logger.warning("asset_prefetch_budget_exceeded", extra={"pending": sum(not f.done() for f in futures)})
        finally:
            # Never wait for stragglers: their results are simply not used.
            executor.shutdown(wait=False, cancel_futures=True)
        return warmed
    except Exception:  # noqa: BLE001 - an optimisation must never fail a download
        logger.exception("asset_prefetch_failed")
        return 0
