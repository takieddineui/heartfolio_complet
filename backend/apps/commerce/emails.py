"""Transactional email (§12).

PROVIDER: Resend, called over plain HTTP rather than through its SDK — one
POST to one endpoint, and `requests` is already a dependency. A vendor SDK
for a single call would be a dependency to keep updated for no benefit.

TRIGGER: fired when an order transitions to `paid`, from inside the verified
webhook path. Not a separate manual step and not something staff sends.

ENGLISH ONLY, DELIBERATELY. `Order.locale` now exists and records the
language the order was placed in, so sending in the customer's language is
technically available — but the decision was to keep the first version
English-only. The locale is passed in and logged rather than ignored, so the
day that changes, the plumbing is already here and the only work is writing
the other two templates.

FAILURE IS NEVER FATAL TO AN ORDER. `send_order_confirmation` swallows every
exception and logs it. A customer who has paid must end up with a paid order
and granted entitlements whether or not Resend is reachable — an email
provider outage rolling back a confirmed payment would be a far worse bug
than a missing receipt. The order page works regardless; the email is a
convenience layer over it.
"""

from __future__ import annotations

import base64
import logging

import requests
from django.conf import settings

from .order_access import generate_order_access_token

logger = logging.getLogger("heartfolio")

RESEND_ENDPOINT = "https://api.resend.com/emails"
_TIMEOUT_SECONDS = 10


def build_order_link(order) -> str:
    """The magic link: the order page, plus a token that grants access to it
    without a session cookie.

    §12 — the token is a PATH segment now, not `?token=`; see `withToken`
    in the frontend's lib/api/client.ts for why.

    ALSO FIXES A REAL BUG FOUND WHILE TOUCHING THIS LINE: it hardcoded
    `/en/` regardless of the order's actual locale, so a French or Arabic
    customer's emailed receipt always opened the order page in English.
    `bonuses.py`'s equivalent link (built from the same token, for the
    QR code) already used `order.locale` correctly — this one had simply
    drifted from it.
    """
    token = generate_order_access_token(order.id)
    return f"{settings.FRONTEND_URL}/{order.locale}/orders/{order.id}/{token}"


def _order_has_live_page(order) -> bool:
    """Whether this order's pack includes the live keepsake.

    Delegates to `bonus_targets_for_order` rather than checking the pack
    slug, so the same rule that decides which bonuses ship in the zip
    decides whether the email carries a QR. Two rules would drift.

    Imported inside the function: `apps.delivery` imports commerce models,
    and importing it at module scope here closes the circle.
    """
    try:
        from apps.delivery.bonuses import BONUS_QR, bonus_targets_for_order

        return BONUS_QR in bonus_targets_for_order(order)
    except Exception:  # noqa: BLE001
        # A receipt that arrives without a QR is a small loss; one that
        # never arrives is not.
        logger.exception("order_email_qr_check_failed", extra={"order_id": str(order.id)})
        return False


def _render(order, link: str, *, include_qr: bool | None = None) -> tuple[str, str, str]:
    """Returns (subject, html, text).

    A plain-text alternative is included because some clients render it in
    preference to HTML, and a receipt that arrives blank is worse than a
    plain one.

    `include_qr` says whether the gift QR section appears. `_send` passes
    whether the card ACTUALLY RENDERED, so the copy ("attached") and the inline
    image can never describe something that is not there. Left as None — a
    direct caller — it falls back to "does this pack have a live page".
    """
    product_name = order.product.slug.replace("-", " ").title()
    total = f"{order.total_cents / 100:.2f} {order.currency}"

    subject = f"Your Heartfolio order — {product_name}"

    # §18d — the GIFT QR card, for orders whose pack includes the live page.
    #
    # IT IS THE RECIPIENT'S CARD, not the buyer's. It used to be the buyer's,
    # which encodes the buyer's order page plus a signed token that expires
    # after ORDER_ACCESS_TOKEN_MAX_AGE_DAYS — while this copy told the buyer to
    # "give it with the gift". The recipient's card opens the live keepsake
    # directly through its own permanent id. The buyer needs no QR for their
    # own order: the "Open your order" link above is theirs.
    #
    # BOTH INLINE AND ATTACHED, deliberately. Most mail clients block
    # remote images by default, so an inline-only QR arrives as a broken
    # box for a large share of readers; an attachment always survives but
    # has to be opened. Doing both means the reader sees it immediately
    # where images are allowed, and still has the file where they are not.
    #
    # THE COPY DOES NOT SAY "PRINT IT" AS THE ONLY USE: people forward the
    # email or show the phone screen as often as they print.
    if include_qr is None:
        include_qr = _order_has_live_page(order)
    qr_html = ""
    qr_text = ""
    if include_qr:
        qr_url = (
            f"{settings.FRONTEND_URL}/api/backend/orders/{order.id}/qr/recipient/"
            f"{generate_order_access_token(order.id)}/"
        )
        qr_html = f"""
    <p style="margin:0 0 8px;text-align:center;">
      <img src="{qr_url}" alt="Scan to open the keepsake" width="220"
           style="width:220px;max-width:70%;height:auto;border-radius:8px;" />
    </p>
    <p style="line-height:1.6;margin:0 0 24px;text-align:center;font-size:14px;color:#6b6b75;">
      This QR card is for the gift — scanning it opens the keepsake directly
      on a phone. Print it, show it on a screen, or simply forward it as it
      is. It is attached to this email too.
    </p>"""
        qr_text = (
            "\nA QR card for the gift is attached — scanning it opens the "
            "keepsake directly on a phone. Print it, show it on a screen, or "
            "simply forward it as it is.\n"
        )

    html = f"""<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#faf7f2;font-family:Georgia,serif;color:#2b2b33;">
  <div style="max-width:520px;margin:0 auto;background:#fffdfa;padding:32px;border-radius:8px;">
    <h1 style="font-size:22px;margin:0 0 16px;">Thank you — your keepsake is ready</h1>
    <p style="line-height:1.6;margin:0 0 16px;">
      Your payment for <strong>{product_name}</strong> has gone through, and your
      files are waiting for you.
    </p>
    <p style="line-height:1.6;margin:0 0 24px;">Total paid: <strong>{total}</strong></p>
    <p style="margin:0 0 24px;">
      <a href="{link}"
         style="display:inline-block;background:#2b2b33;color:#fffdfa;text-decoration:none;
                padding:12px 24px;border-radius:6px;">Open your order</a>
    </p>
    {qr_html}
    <p style="line-height:1.6;margin:0 0 8px;font-size:14px;color:#6b6b75;">
      This link works on any device and does not need a password. It stays
      valid for {settings.ORDER_ACCESS_TOKEN_MAX_AGE_DAYS} days — if it ever
      stops working, just reply to this email and we will send a fresh one.
    </p>
    <p style="line-height:1.6;margin:16px 0 0;font-size:14px;color:#6b6b75;">
      Order reference: {order.id}
    </p>
  </div>
</body>
</html>"""

    text = (
        "Thank you — your keepsake is ready\n\n"
        f"Your payment for {product_name} has gone through, and your files are waiting.\n"
        f"Total paid: {total}\n\n"
        f"Open your order: {link}\n\n"
        f"This link works on any device and does not need a password. It stays valid for "
        f"{settings.ORDER_ACCESS_TOKEN_MAX_AGE_DAYS} days — if it stops working, reply to this "
        "email and we will send a fresh one.\n\n"
        f"{qr_text}"
        f"Order reference: {order.id}\n"
    )

    return subject, html, text


def send_order_confirmation(order) -> bool:
    """Sends the receipt. Returns True if Resend accepted it.

    Never raises. See the module docstring: an email provider outage must not
    be able to affect an order that has already been paid for.
    """
    if not settings.RESEND_API_KEY:
        # Local development and CI. Logged rather than silent, so an
        # unconfigured production deploy is visible in the logs rather than
        # merely producing no email.
        logger.warning(
            "order_email_skipped_no_api_key",
            extra={"order_id": str(order.id)},
        )
        return False

    try:
        return _send(order)
    except Exception as exc:  # noqa: BLE001
        # Intentionally broad, and the test suite pins it there.
        #
        # `requests.RequestException` alone is not enough: a bug in the
        # template rendering above — a renamed field, a missing relation —
        # raises something else entirely, and this function is called from
        # the Paddle webhook handler. An exception escaping here would make
        # a successful payment return 500 to Paddle for no reason other than
        # a formatting mistake in a receipt.
        #
        # The order is already durably paid and its entitlements granted by
        # the time this runs, so there is nothing left to protect by failing
        # loudly. Log and move on.
        logger.error(
            "order_email_unexpected_failure",
            extra={"order_id": str(order.id), "error": str(exc)},
        )
        return False


def _qr_attachment(order) -> dict:
    """The GIFT (recipient's) QR card as a Resend attachment, or nothing.

    Base64 rather than a URL because this is the half of the delivery that
    has to work when the reader's client blocks remote images. Wrapped in
    its own try/except for the same reason as the check above: a card that
    fails to render must not take the receipt with it.

    The recipient's card can fail where the buyer's could not: it needs the
    order's live experience to be active, and raises `RendererNotAvailable`
    when it is not (provisioning failed, or the link was revoked). That lands
    in the except below and returns nothing — and `_send` then leaves the QR
    section OUT of the email entirely, because its inline image would hit the
    same failure and show a broken box while the copy promised an attachment.
    """
    if not _order_has_live_page(order):
        return {}
    try:
        from apps.delivery.bonuses import render_recipient_qr_card

        payload = base64.b64encode(render_recipient_qr_card(order)).decode("ascii")
        return {"attachments": [{"filename": "heartfolio-gift-qr.png", "content": payload}]}
    except Exception:  # noqa: BLE001
        logger.exception("order_email_qr_attach_failed", extra={"order_id": str(order.id)})
        return {}


def _send(order) -> bool:
    link = build_order_link(order)
    # Rendered BEFORE the body so the body only mentions a QR that exists.
    attachment = _qr_attachment(order)
    subject, html, text = _render(order, link, include_qr=bool(attachment))

    try:
        response = requests.post(
            RESEND_ENDPOINT,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.RESEND_FROM_EMAIL,
                "to": [order.guest_email],
                # The receipt says "reply to this email": replies go to support.
                **({"reply_to": settings.RESEND_REPLY_TO_EMAIL} if settings.RESEND_REPLY_TO_EMAIL else {}),
                "subject": subject,
                "html": html,
                "text": text,
                **attachment,
            },
            timeout=_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.error(
            "order_email_send_failed",
            extra={"order_id": str(order.id), "error": str(exc)},
        )
        return False

    if response.status_code >= 400:
        logger.error(
            "order_email_rejected",
            extra={
                "order_id": str(order.id),
                "status_code": response.status_code,
                # Body, not just status: Resend returns the actual reason
                # (unverified domain, invalid recipient) and without it a
                # production failure is unactionable.
                "body": response.text[:500],
            },
        )
        return False

    logger.info(
        "order_email_sent",
        # `locale` is recorded even though the template is English-only, so
        # the logs show how much demand there is for translating it.
        extra={"order_id": str(order.id), "locale": order.locale},
    )
    return True
