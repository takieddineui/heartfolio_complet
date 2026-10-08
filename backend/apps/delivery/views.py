"""
`GET /api/v1/entitlements/<uuid>/download/` — the only entry point into
the delivery/renderer system. No client input beyond the entitlement id
in the URL influences which project/renderer is used: the customer is
always resolved from the session (never client-supplied), and the
project/renderer are always derived server-side from the entitlement's
own order — a client-supplied query parameter of any kind (e.g. trying
to point at a different project) has no effect at all, since none is
ever read.
"""

import io
import logging
import zipfile

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse, StreamingHttpResponse

from apps.common.exceptions.api_errors import EntitlementNotFound, RendererNotAvailable
from apps.common.telegram import send_alert
from apps.customers.authentication import CsrfEnforcedSessionAuthentication
from apps.customers.services import get_current_customer

from .renderers import DigitalDeliveryResult, TemporaryFileResult
from apps.delivery.moment_wallpapers import moment_wallpapers_for_order
from apps.delivery.bonuses import (
    BONUS_PRINT_ADVICE,
    BONUS_QR,
    BONUS_THANK_YOU,
    QR_CARD_VARIANTS,
    bonus_targets_for_order,
    pdf_targets_for_order,
    png_to_pdf,
    render_live_qr_card,
    render_printing_advice_pdf,
    render_recipient_qr_card,
    render_thank_you_card,
)
from apps.assets.services import asset_bytes_cache
from apps.delivery.delivery_types import DeliveryType, infer_delivery_type
from apps.delivery.photo_prefetch import prefetch_order_photos
from apps.delivery.product_renderers.love_story_timeline.png_renderer import TARGET_DIMENSIONS

from .services import (
    get_delivery_for_entitlement,
    get_entitlement_by_order_token,
    get_entitlement_for_customer,
    get_paid_order_by_access_token,
    get_pack_deliveries_for_order,
    get_paid_order_for_delivery,
    pack_has_archivable_entitlements,
)

# These are personalized, emotionally significant outputs tied to one
# customer's paid order — never appropriate for a shared/proxy cache to
# store, even briefly. Applied to every response this view returns,
# both the binary-file path and the JSON (digital) path below.
_NO_STORE_CACHE_CONTROL = "private, no-store"

# `TemporaryFileResult.filename` is currently always derived from
# `Entitlement.target_id`, which is itself never client input at
# request time (see `DeliveryPack.included_targets` — populated by
# admin/fixture data only, not any public write endpoint). So there is
# no live path traversal/header-injection vector today. This is
# defense-in-depth for a value that goes directly into an HTTP header:
# strips path separators, control characters (including CR/LF, which
# could otherwise inject extra header lines), and anything that isn't
# a conservative filename character.
_SAFE_FILENAME_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
)


def _safe_filename(raw: str, *, fallback: str = "download") -> str:
    cleaned = "".join(ch for ch in raw if ch in _SAFE_FILENAME_CHARS)
    cleaned = cleaned.lstrip(".")  # no leading-dot/hidden-file tricks
    return cleaned or fallback


logger = logging.getLogger("heartfolio")


class EntitlementDownloadView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    # Phase 3.14: rendering is genuine CPU work (image composition),
    # not a cheap read — the clearest rendering/download abuse target
    # called out in the Phase 3.14 audit checklist.
    throttle_scope = "delivery_download"

    def get(self, request, entitlement_id, token=None):
        # §12 — the emailed link must work on a device with no session.
        # `token` arrives as a URL kwarg now (path segment), not a query
        # string — see `withToken` in the frontend's lib/api/client.ts for
        # why. The two-routes-one-view shape in urls.py is what makes this
        # an optional parameter here: Django supplies it only when the
        # token-bearing pattern matched.
        if token:
            entitlement = get_entitlement_by_order_token(entitlement_id, token)
        else:
            customer = get_current_customer(request)
            entitlement = get_entitlement_for_customer(customer, entitlement_id)
        result = get_delivery_for_entitlement(entitlement)

        if isinstance(result, DigitalDeliveryResult):
            # A Digital Product delivery is a shareable URL, not a
            # binary download — plain JSON. No storage keys, no
            # internal ids beyond the entitlement the caller already
            # knows about.
            response = Response({"url": result.url})
            response["Cache-Control"] = _NO_STORE_CACHE_CONTROL
            return response

        if isinstance(result, TemporaryFileResult):
            response = HttpResponse(result.content, content_type=result.content_type)
            filename = _safe_filename(result.filename)
            response["Content-Disposition"] = f'attachment; filename="{filename}"'
            response["Cache-Control"] = _NO_STORE_CACHE_CONTROL
            return response

        # Defensive: every real renderer is expected to return one of
        # the two DeliveryResult variants above. Reaching here means a
        # renderer implementation bug, not a normal error case.
        raise RendererNotAvailable("Renderer returned an unrecognized result type.")


class OrderQrCardView(APIView):
    """`GET /api/v1/orders/<uuid>/qr/` — the live-page QR card as a PNG.

    WHY AN ENDPOINT RATHER THAN THE ZIP ONLY. The card was reachable only
    by downloading the pack and opening `bonus/`, which is a strange place
    to hide the one thing a customer wants to show someone else. The order
    page and the receipt email both need a URL, and this is it.

    Access is the same as every other delivery: the session that owns the
    paid order, or the magic-link token. A QR that anyone could fetch by
    guessing an order id would hand over the keepsake itself, since the
    card encodes the access link.

    ONLY FOR ORDERS THAT ACTUALLY HAVE A LIVE PAGE. `bonus_targets_for_order`
    decides, reading the pack's targets rather than its name, so a new pack
    including `__live__` gets this without anyone updating a list.
    """

    authentication_classes = [CsrfEnforcedSessionAuthentication]
    permission_classes = [AllowAny]

    def get(self, request, order_id, token: str = ""):
        if token:
            order = get_paid_order_by_access_token(order_id, token)
        else:
            customer = get_current_customer(request)
            order = get_paid_order_for_delivery(customer, order_id)

        if BONUS_QR not in bonus_targets_for_order(order):
            raise EntitlementNotFound()

        variant = QR_CARD_VARIANTS[0]
        response = HttpResponse(render_live_qr_card(order, variant), content_type="image/png")
        # Never cached by a shared cache: the payload embeds a signed
        # access token, and a CDN holding it would be handing out keys.
        response["Cache-Control"] = "private, no-store"
        response["Content-Disposition"] = f'inline; filename="heartfolio-qr-{variant}.png"'
        return response


class OrderRecipientQrCardView(APIView):
    """`GET /api/v1/orders/<uuid>/qr/recipient/` — the RECIPIENT's QR, as a
    PNG: scanning it opens the live keepsake directly, not the order page.

    Same access model, same `BONUS_QR` gate and same "default design only"
    scoping as `OrderQrCardView` above — this is that view's sibling for
    the other audience, not a different security surface. See
    `render_recipient_qr_card`'s own docstring for why this is a separate
    card rather than a fifth `QR_CARD_VARIANT`.
    """

    authentication_classes = [CsrfEnforcedSessionAuthentication]
    permission_classes = [AllowAny]

    def get(self, request, order_id, token: str = ""):
        if token:
            order = get_paid_order_by_access_token(order_id, token)
        else:
            customer = get_current_customer(request)
            order = get_paid_order_for_delivery(customer, order_id)

        if BONUS_QR not in bonus_targets_for_order(order):
            raise EntitlementNotFound()

        variant = QR_CARD_VARIANTS[0]
        response = HttpResponse(render_recipient_qr_card(order, variant), content_type="image/png")
        # Unlike the buyer's QR this payload carries no signed token — see
        # `_recipient_live_url`'s own docstring — but the response still
        # embeds the live keepsake's own permanent, unguessable id, which
        # a shared cache has no more business holding than a session
        # cookie would.
        response["Cache-Control"] = "private, no-store"
        response["Content-Disposition"] = f'inline; filename="heartfolio-qr-recipient-{variant}.png"'
        return response


def _resolve_order(request, order_id, token):
    """Same token-or-session resolution every download view in this file
    already used, pulled out once four views need it instead of one."""
    if token:
        return get_paid_order_by_access_token(order_id, token)
    customer = get_current_customer(request)
    return get_paid_order_for_delivery(customer, order_id)


def _zip_response(buffer: io.BytesIO, filename: str) -> HttpResponse:
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{_safe_filename(filename)}"'
    response["Cache-Control"] = _NO_STORE_CACHE_CONTROL
    return response


class OrderPrintableDownloadView(APIView):
    """`GET /api/v1/orders/<uuid>/download/printable/` — every print file
    the order includes, in one archive.

    §14 — the category views (this and the three below) exist because the
    single "everything" zip conflated four things a customer thinks of as
    separate: what to print, what to set as a wallpaper, the QR that links
    to the live page, and the small extras. A Printable-only customer had
    no reason to receive a zip whose name promised "everything" and
    contained exactly the one category they bought; a Complete customer
    had no way to hand a print shop just the print files without also
    handing over wallpapers the shop does not need.

    CLASSIFIED WITH `infer_delivery_type`, not by string-matching target
    ids. That function already resolves the pack-slug disambiguation
    (`"story-png"` means something different bought via `wallpaper` than
    via `social`); duplicating that logic here with a fresh prefix check
    would be a second place for the two to quietly disagree.

    The existing `OrderPackDownloadView` (`/download/`) is UNCHANGED and
    stays — a fifth, "everything" option, not replaced by these four.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "delivery_download"

    # Each print size renders from the same few photos; read each from R2
    # once per request, not once per file. See `asset_bytes_cache`.
    @asset_bytes_cache()
    def get(self, request, order_id, token=None):
        order = _resolve_order(request, order_id, token)
        prefetch_order_photos(order)
        deliveries = get_pack_deliveries_for_order(order)
        pdf_targets = set(pdf_targets_for_order(order))
        pack_slug = order.delivery_pack.slug if order.delivery_pack_id else None

        buffer = io.BytesIO()
        written = 0
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entitlement, result in deliveries:
                if not isinstance(result, TemporaryFileResult):
                    continue
                target_id = str(entitlement.target_id)
                if infer_delivery_type(target_id=target_id, delivery_pack_slug=pack_slug) != DeliveryType.PRINTABLE:
                    continue

                name = _safe_filename(result.filename, fallback=_safe_filename(target_id))
                archive.writestr(name, result.content)
                written += 1

                # §18c — the PDF wrapper, same as the everything-zip. A
                # print shop commonly wants the PDF; this view exists
                # specifically for that customer, so it would be strange
                # for it to be the one place the PDF is missing.
                if target_id in pdf_targets:
                    try:
                        dimensions = TARGET_DIMENSIONS.get(target_id)
                        if dimensions:
                            archive.writestr(
                                _safe_filename(f"{target_id}.pdf", fallback="print.pdf"),
                                png_to_pdf(result.content, width_px=dimensions[0], height_px=dimensions[1]),
                            )
                            written += 1
                    except Exception:  # noqa: BLE001
                        logger.exception("bonus_pdf_failed", extra={"target_id": target_id})

        if written == 0:
            # Reachable for a pack with no print targets at all — the
            # frontend is expected to hide this button in that case, so
            # reaching here means a stale UI or a direct API call.
            raise RendererNotAvailable("This pack has no printable files.")

        filename = f"heartfolio-{order.product.slug}-printable.zip" if order.product_id else "heartfolio-printable.zip"
        return _zip_response(buffer, filename)


class OrderWallpaperDownloadView(APIView):
    """`GET /api/v1/orders/<uuid>/download/wallpapers/` — story wallpaper
    plus every moment wallpaper, across every device the pack includes.

    Moment wallpapers are resolved the same way the everything-zip
    resolves them — `moment_wallpapers_for_order`, at delivery time, not
    from `included_targets` — because a pack is defined before any
    customer exists and cannot know how many milestones a given story
    will have. See that function's own docstring.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "delivery_download"

    # Same reasoning as `OrderPrintableDownloadView.get`: one R2 read per
    # photo per request.
    @asset_bytes_cache()
    def get(self, request, order_id, token=None):
        order = _resolve_order(request, order_id, token)
        prefetch_order_photos(order)
        deliveries = get_pack_deliveries_for_order(order)
        pack_slug = order.delivery_pack.slug if order.delivery_pack_id else None

        buffer = io.BytesIO()
        written = 0
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entitlement, result in deliveries:
                if not isinstance(result, TemporaryFileResult):
                    continue
                target_id = str(entitlement.target_id)
                if infer_delivery_type(target_id=target_id, delivery_pack_slug=pack_slug) != DeliveryType.WALLPAPER:
                    continue
                name = _safe_filename(result.filename, fallback=_safe_filename(target_id))
                archive.writestr(name, result.content)
                written += 1

            try:
                for target_id, content, filename in moment_wallpapers_for_order(order):
                    archive.writestr(_safe_filename(filename, fallback=target_id), content)
                    written += 1
            except Exception:  # noqa: BLE001
                logger.exception("moment_wallpapers_failed", extra={"order_id": str(order.id)})

        if written == 0:
            raise RendererNotAvailable("This pack has no wallpaper files.")

        filename = f"heartfolio-{order.product.slug}-wallpapers.zip" if order.product_id else "heartfolio-wallpapers.zip"
        return _zip_response(buffer, filename)


def _qr_card_files(order, prefix: str = ""):
    """Yields `(path, png bytes)` for EVERY QR card this order earns: the
    buyer's card in each design, then the recipient's card in each design.

    ONE PLACE for the file list, used by both the dedicated QR zip and the
    whole-pack zip's `bonus/` folder, so "which QR cards does a customer get"
    has a single answer and the two downloads cannot drift apart.

    The default design keeps the bare name and the alternates carry their
    design name — the same convention the buyer's cards always had, so adding
    the recipient's set renames nothing:

        live-page-qr.png                    live-page-qr-recipient.png
        live-page-qr-cream.png              live-page-qr-recipient-cream.png
        live-page-qr-tag.png                live-page-qr-recipient-tag.png
    """
    for index, design in enumerate(QR_CARD_VARIANTS):
        suffix = "" if index == 0 else f"-{design}"
        yield f"{prefix}live-page-qr{suffix}.png", render_live_qr_card(order, design)
    for index, design in enumerate(QR_CARD_VARIANTS):
        suffix = "" if index == 0 else f"-{design}"
        yield f"{prefix}live-page-qr-recipient{suffix}.png", render_recipient_qr_card(order, design)


class OrderLiveCardsDownloadView(APIView):
    """`GET /api/v1/orders/<uuid>/download/live-cards/` — the QR cards, in
    every design, zipped: the BUYER's cards (scan to open the order page) and
    the RECIPIENT's cards (scan to open the live keepsake directly).

    ONE ZIP FOR BOTH. They used to be two downloads, a button each. A buyer
    handing this keepsake to someone needs both in the same place — their own
    card to keep and the other to give away — and a second zip to find was
    just friction. The two sets stay distinguishable by file name
    (`live-page-qr*.png` vs `live-page-qr-recipient*.png`); see
    `_qr_card_files`. The on-page previews of the two cards are unchanged.

    MOVED OUT OF "Bonuses" ON PURPOSE. The QR card links TO the live page
    — it is the live entitlement's own companion, not a generic extra the
    way the thank-you card and the printing-advice sheet are. Grouping it
    here means "open the live page" and "download its QR" sit together as
    the two things that belong to one purchase, rather than the QR being
    buried in a differently-themed zip a customer has no reason to
    associate with the live page at all.

    Requires `__live__` in the pack, same as `OrderQrCardView` (the
    single-image endpoint this complements) — both raise for the same
    reason if the pack never granted a live page.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "delivery_download"

    def get(self, request, order_id, token=None):
        order = _resolve_order(request, order_id, token)
        if BONUS_QR not in bonus_targets_for_order(order):
            raise EntitlementNotFound()

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in _qr_card_files(order):
                archive.writestr(name, content)

        filename = f"heartfolio-{order.product.slug}-live-qr.zip" if order.product_id else "heartfolio-live-qr.zip"
        return _zip_response(buffer, filename)


class OrderBonusesDownloadView(APIView):
    """`GET /api/v1/orders/<uuid>/download/bonuses/` — the thank-you card,
    and the printing-advice sheet when the pack includes print targets.

    Deliberately excludes the QR — see `OrderLiveCardsDownloadView`'s
    docstring for why it lives there instead. What is left here is
    genuinely generic to the order: a thank-you note every purchase gets,
    and printing guidance that only makes sense alongside actual print
    files.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "delivery_download"

    def get(self, request, order_id, token=None):
        order = _resolve_order(request, order_id, token)
        bonuses = bonus_targets_for_order(order)

        buffer = io.BytesIO()
        written = 0
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            if BONUS_THANK_YOU in bonuses:
                archive.writestr("thank-you.pdf", render_thank_you_card())
                written += 1
            if BONUS_PRINT_ADVICE in bonuses:
                archive.writestr("how-to-print.pdf", render_printing_advice_pdf())
                written += 1

        if written == 0:
            raise RendererNotAvailable("This pack has no bonus files.")

        filename = f"heartfolio-{order.product.slug}-bonuses.zip" if order.product_id else "heartfolio-bonuses.zip"
        return _zip_response(buffer, filename)


class _ZipChunkStream:
    """A minimal file-like object for `zipfile.ZipFile` to write into,
    whose already-written bytes can be drained out as chunks.

    `zipfile` writes synchronously and needs a `tell()` that reports the
    true cumulative offset (for its local file headers and central
    directory) — so `write()` appends to a small pending buffer and
    tracks the running total separately, and `dequeue()` hands back and
    clears only the pending part. That seam is what turns `ZipFile`'s
    normal blocking writes into a sequence of chunks a generator can
    `yield` to an HTTP response as they're produced, instead of
    accumulating the whole archive in one buffer before anything is
    sent (see `_iter_pack_archive` below, and the download-memory
    measurement in PROJECT-STATE.md this replaces).
    """

    def __init__(self) -> None:
        self._pending = bytearray()
        self._offset = 0

    def write(self, data: bytes) -> int:
        self._pending.extend(data)
        self._offset += len(data)
        return len(data)

    def tell(self) -> int:
        return self._offset

    def flush(self) -> None:
        pass

    def dequeue(self) -> bytes:
        chunk = bytes(self._pending)
        self._pending.clear()
        return chunk


def _iter_pack_archive(order, pdf_targets: set[str]):
    """`_iter_pack_archive_uncached` with each photo read from R2 once for
    the whole archive instead of once per rendered file — see
    `asset_bytes_cache` — and the order's photos fetched concurrently up
    front, see `prefetch_asset_bytes`. A wrapper rather than a decorator because the
    cache must stay open across every `yield`, and `with` inside a
    generator is exactly that: the block closes when the generator is
    exhausted, raises, or is closed by the server on a client disconnect.
    """
    with asset_bytes_cache():
        prefetch_order_photos(order)
        yield from _iter_pack_archive_uncached(order, pdf_targets)


def _iter_pack_archive_uncached(order, pdf_targets: set[str]):
    """Renders and zips the pack one entry at a time, yielding each
    chunk as soon as it exists rather than building the whole archive
    in memory first.

    Sequential, not batched: `get_pack_deliveries_for_order` is a
    generator now, so only ONE entitlement's render is ever in flight,
    and `del result` below drops the only reference to its (large — a
    poster-sized PNG plus the three source photos behind it) bytes the
    moment its entry is written, instead of holding all nine of a
    Complete pack's renders alongside a growing zip buffer the way the
    old eager-list version did.

    ERROR HANDLING DELIBERATELY ISN'T UNIFORM, because the four things
    this writes aren't equally important:

    - A failure rendering a PURCHASED entitlement (the only case
      wrapped below in a `try` that re-raises) is fatal, exactly as it
      already was before this was a stream: the non-streaming view let
      the same exception reach Django's default 500 handler uncaught.
      The difference streaming makes is WHEN the client finds out — if
      any chunk has already been sent, the status/headers are already
      committed, so there is no "send a 500 page" left to do. Logging,
      alerting, and re-raising here aborts the connection instead: no
      `archive.close()` runs, so no valid end-of-central-directory
      record is ever written, and what the client already has is a
      zip too broken to open, not a smaller-but-plausible one. Per
      gunicorn's docs the sync worker's own `--timeout` covers total
      time handling the request regardless of streaming, so this does
      not change what a hang looks like — only what a raised exception
      looks like.
    - A PDF-wrapper, moment-wallpaper, or bonus failure keeps the
      pre-existing swallow-and-continue behavior (log, move on) —
      those were already non-fatal ("a bonus must never cost a
      customer the thing they paid for"), and streaming doesn't change
      that risk calculus.
    """
    stream = _ZipChunkStream()
    archive = zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED)

    try:
        for entitlement, result in get_pack_deliveries_for_order(order):
            if not isinstance(result, TemporaryFileResult):
                # Digital/URL deliveries have no bytes to archive.
                continue
            target_id = str(entitlement.target_id)
            # `target_id` is admin-controlled data, never request input,
            # but it is sanitised anyway before becoming a path inside
            # the archive — same defense-in-depth as the
            # Content-Disposition filename below.
            name = _safe_filename(result.filename, fallback=_safe_filename(target_id))
            archive.writestr(name, result.content)
            chunk = stream.dequeue()
            if chunk:
                yield chunk

            # §18c — printable images as PDF as well as PNG, because
            # print shops commonly prefer it. IN ADDITION to the PNG
            # above, never replacing it: the PNG is what the customer
            # bought and what opens on any device without a reader.
            if target_id in pdf_targets:
                try:
                    dimensions = TARGET_DIMENSIONS.get(target_id)
                    if dimensions:
                        archive.writestr(
                            _safe_filename(f"{target_id}.pdf", fallback="print.pdf"),
                            png_to_pdf(result.content, width_px=dimensions[0], height_px=dimensions[1]),
                        )
                        chunk = stream.dequeue()
                        if chunk:
                            yield chunk
                except Exception:  # noqa: BLE001
                    # A bonus must never cost a customer the thing they
                    # paid for. If the PDF wrapper fails, the PNG is
                    # already in the archive and the download proceeds.
                    logger.exception("bonus_pdf_failed", extra={"target_id": target_id})
            del result
    except Exception as exc:  # noqa: BLE001
        logger.exception("pack_archive_render_failed", extra={"order_id": str(order.id)})
        send_alert(
            "PACK DOWNLOAD FAILED MID-STREAM\n"
            f"order: {order.id}\n"
            f"reason: {type(exc).__name__}: {exc}"
        )
        # No `archive.close()`: closing would write a valid (if
        # incomplete) end-of-central-directory record, which is exactly
        # the "truncated but plausible-looking file" this must not send.
        # Re-raising with whatever chunks already went out unterminated
        # is what makes the client's unzip — and the browser's download
        # — both report failure rather than quietly accepting less than
        # what was paid for.
        raise

    # §13 — the per-milestone wallpapers.
    #
    # Expanded HERE rather than stored in the pack's `included_targets`,
    # because a pack is defined before any customer exists and cannot
    # know how many milestones a story will have. The pack grants
    # "wallpapers"; how many moment files that means is a property of
    # the story, resolved at delivery.
    #
    # Wrapped like the bonuses below: a failure to render one memory
    # must not cost the customer the rest of a paid download. (Already a
    # generator — see moment_wallpapers.py — so this was never holding
    # every moment wallpaper in memory at once, streaming or not.)
    try:
        for target_id, content, filename in moment_wallpapers_for_order(order):
            archive.writestr(_safe_filename(filename, fallback=target_id), content)
            chunk = stream.dequeue()
            if chunk:
                yield chunk
    except Exception:  # noqa: BLE001
        logger.exception("moment_wallpapers_failed", extra={"order_id": str(order.id)})

    # §18a/b/d — bonuses, added to the archive rather than stored as
    # entitlements. They are consequences of what was bought, not
    # things that were bought; see `bonuses.py`.
    #
    # Wrapped as a whole for the same reason as above: a broken
    # thank-you card must not turn a successful purchase into a
    # failed download.
    try:
        for bonus in bonus_targets_for_order(order):
            if bonus == BONUS_THANK_YOU:
                archive.writestr("bonus/thank-you.pdf", render_thank_you_card())
            elif bonus == BONUS_PRINT_ADVICE:
                archive.writestr("bonus/how-to-print.pdf", render_printing_advice_pdf())
            elif bonus == BONUS_QR:
                # All card designs ship, for BOTH audiences — the
                # buyer's and the recipient's (see `_qr_card_files`).
                # One design is the default — shown on the order page
                # and sent in the email — and the rest are alternates
                # here, because the right card depends on where it is
                # going: a fridge, a frame, or tied to a gift. This is
                # the "everything" download, so it carries everything
                # the dedicated QR zip does.
                for name, content in _qr_card_files(order, prefix="bonus/"):
                    archive.writestr(name, content)
            chunk = stream.dequeue()
            if chunk:
                yield chunk
    except Exception:  # noqa: BLE001
        logger.exception("bonus_generation_failed", extra={"order_id": str(order.id)})

    archive.close()
    chunk = stream.dequeue()
    if chunk:
        yield chunk


class OrderPackDownloadView(APIView):
    """`GET /api/v1/orders/<uuid>/download/` — the whole purchased pack
    as a single archive.

    Heartfolio sells packs, not files: a customer who buys the Complete
    Pack should get their keepsake in one action rather than clicking
    six times. This exists purely to match that, and adds no new
    authorization or rendering concept — it resolves the customer from
    the session exactly as the single-file view does, reuses the same
    ownership/paid checks, and renders each entitlement through the
    same `get_delivery_for_entitlement` path.

    STREAMED, via `_iter_pack_archive` above: the archive is assembled
    and sent as a `StreamingHttpResponse`, one zip entry at a time, not
    built whole in a `BytesIO` first. A Complete pack's render measured
    ~140MB of peak RSS growth across nine renders alone, then climbed
    past 500MB once the old code's growing zip buffer and its final
    `getvalue()` copy were added on top — enough to get a 512MB
    container's gunicorn worker OOM-killed mid-request (see
    PROJECT-STATE.md's download-memory item for the full measurement).
    Streaming removes the `getvalue()` copy entirely and stops holding
    every rendered entry's bytes alive at once; it does not (and
    cannot) lower the cost of any SINGLE render, which is the floor
    Step 1's measurement found and Step 2's write-up reports options
    for.

    Response `Content-Length` is UNKNOWN ahead of time (the archive's
    final size depends on how well each entry compresses) — Django
    omits the header for a `StreamingHttpResponse` for exactly this
    reason, the connection uses chunked transfer encoding, and the
    frontend's download (`lib/api/delivery.ts`, `fetch` then
    `response.blob()`) already works this way: `blob()` reads a stream
    to completion regardless of whether a length was declared.

    Neither the individual files nor the zip are persisted to R2 or
    anywhere else — still true, streaming or not.

    A digital (`__live__`) entitlement that resolves to a URL rather
    than bytes is skipped here — a link cannot be a file inside a zip.
    Those remain available individually from the entitlement endpoint,
    which is why that route stays the primary one and this is an
    additional convenience rather than a replacement.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    # Rendering an entire pack is the heaviest operation in the system
    # — the same scope as a single render, deliberately, so a pack
    # download costs the same budget as the file downloads it replaces.
    throttle_scope = "delivery_download"

    def get(self, request, order_id, token=None):
        # §12 — same as the single-file view: token or session, not both.
        # See EntitlementDownloadView.get for why `token` is a kwarg now.
        if token:
            order = get_paid_order_by_access_token(order_id, token)
        else:
            customer = get_current_customer(request)
            order = get_paid_order_for_delivery(customer, order_id)

        # Checked BEFORE any streaming starts — once `StreamingHttpResponse`
        # has yielded its first chunk the 200 status is already committed,
        # and "nothing archivable" can no longer become a clean 501. See
        # `pack_has_archivable_entitlements`'s docstring for why this check
        # doesn't need to render anything to be accurate.
        if not pack_has_archivable_entitlements(order):
            raise RendererNotAvailable("This pack has no downloadable files.")

        pdf_targets = set(pdf_targets_for_order(order))
        pack_slug = order.delivery_pack.slug if order.delivery_pack_id else "pack"
        filename = _safe_filename(f"heartfolio-{order.product.slug}-{pack_slug}.zip", fallback="heartfolio-pack.zip")

        response = StreamingHttpResponse(_iter_pack_archive(order, pdf_targets), content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = _NO_STORE_CACHE_CONTROL
        return response
