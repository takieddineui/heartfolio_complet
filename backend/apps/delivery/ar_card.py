"""Compositing the QR onto a rendered AR card (§21i).

WHY THIS IS NOT IN THE RENDERER
--------------------------------
The QR encodes the order's OWN experience URL. A renderer that knew about
orders would be a renderer that could not be exercised without one — and the
whole composition test suite renders cards from a normalized timeline and
nothing else.

So the renderer leaves an empty block, its position defined by shared
constants, and this fills it. The seam is a rectangle both sides agree on
rather than a dependency one side has on the other.
"""

from __future__ import annotations

import io
import logging

import qrcode
from PIL import Image

from apps.delivery.ar_support import CARD_MARGIN_RATIO, CARD_QR_BLOCK_RATIO
from apps.delivery.models import PublicExperience

logger = logging.getLogger("heartfolio")


def experience_url(experience, frontend_url: str, locale: str = "en") -> str:
    """The permanent link this card's QR points at (§21f).

    No token and no query string: the id IS the credential, and putting it
    in the path rather than a parameter keeps it out of `Referer` headers —
    the one weakness flagged in the §12 magic-link review that this design
    does not repeat.
    """
    return f"{frontend_url.rstrip('/')}/{locale}/ar/{experience.id}"


def composite_qr(card_png: bytes, *, url: str) -> bytes:
    """Draws the QR into the block the renderer reserved.

    High error correction, because this is printed, then photographed off
    paper by a phone at an angle — a fingerprint or a crease destroys part
    of the symbol, and the redundancy is what makes it still scan.

    A white quiet zone is drawn behind it regardless of palette: a QR on a
    dark background does not scan reliably, and the midnight palette would
    otherwise produce a card that looks right and does not work.
    """
    card = Image.open(io.BytesIO(card_png)).convert("RGB")
    block = int(card.width * CARD_QR_BLOCK_RATIO)
    margin = int(card.width * CARD_MARGIN_RATIO)

    code = qrcode.make(url, error_correction=qrcode.constants.ERROR_CORRECT_H, border=2)
    code = code.convert("RGB").resize((block, block), Image.NEAREST)

    x = card.width - margin - block
    y = card.height - margin - block
    # The quiet zone. Slightly larger than the code so the white extends
    # past it, which is what a scanner needs to find the edges.
    pad = max(4, int(block * 0.06))
    card.paste(Image.new("RGB", (block + pad * 2, block + pad * 2), "#ffffff"), (x - pad, y - pad))
    card.paste(code, (x, y))

    buffer = io.BytesIO()
    card.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def ar_card_for_order(order, card_png: bytes, frontend_url: str) -> bytes | None:
    """The finished card for a purchase, or None if there is no experience.

    None rather than an unfinished card: a card with an empty QR block is
    worse than no card, because it looks complete and does nothing.
    """
    try:
        experience = PublicExperience.objects.get(
            entitlement__order=order, kind=PublicExperience.KIND_AR
        )
    except PublicExperience.DoesNotExist:
        return None

    try:
        return composite_qr(card_png, url=experience_url(experience, frontend_url, order.locale))
    except Exception:  # noqa: BLE001
        logger.exception("ar_card_qr_failed", extra={"order_id": str(order.id)})
        return None
