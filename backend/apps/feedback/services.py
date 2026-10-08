"""Feedback submission (§7c)."""

from apps.commerce.models import Order
from apps.commerce.order_access import verify_order_access_token
from apps.common.telegram import send_alert

from .models import Feedback


class FeedbackOrderNotFound(Exception):
    """Raised for a bad token, a wrong order, or one that does not exist.

    One exception for all three on purpose: distinguishing them would tell
    someone probing order ids which of their guesses was close.
    """


def create_feedback(
    *,
    rating: int | None = None,
    message: str = "",
    order_id=None,
    token: str = "",
    email: str = "",
    display_name: str = "",
    customer=None,
) -> Feedback:
    """Records a submission.

    Ownership for the order-tied mode is proved EITHER by the magic-link
    token §12 puts in the receipt email — so feedback works from that link
    on a device with no session — OR by the session that placed the order,
    which is where a customer is immediately after paying. Requiring the
    token alone meant the post-purchase page could never submit at all.

    Both paths fail into the same `FeedbackOrderNotFound`, so a guessed
    order id still reveals nothing about whether it exists.

    `is_published` is never set here. Nothing a customer sends can publish
    itself; that is a deliberate staff action.
    """
    order = None
    product = None

    if order_id:
        # THE TOKEN IS VERIFIED BEFORE ANY QUERY, and the order is only
        # fetched once some claim of ownership exists. My first version of
        # this fetched first and checked after, which meant a forged token
        # cost a database round-trip — free work for anyone spraying random
        # order ids, and it broke the two `SimpleTestCase` ownership tests
        # that assert a bad token is refused without the database being
        # touched at all.
        by_token = bool(token) and verify_order_access_token(token, order_id=order_id)
        if not by_token and customer is None:
            # No token, no session: nothing to check an order against.
            raise FeedbackOrderNotFound()

        try:
            candidate = Order.objects.select_related("product").get(id=order_id)
        except (Order.DoesNotExist, ValueError, TypeError):
            raise FeedbackOrderNotFound()

        # A valid token stands on its own. Otherwise the session must own
        # the order — the post-purchase page has no token.
        if not by_token and candidate.customer_id != customer.id:
            raise FeedbackOrderNotFound()

        order = candidate
        product = order.product

    feedback = Feedback.objects.create(
        order=order,
        product=product,
        rating=rating,
        message=message or "",
        # An email on an order-tied submission is noise: the order already
        # knows who to reply to, and storing a second, unverified address
        # invites replying to the wrong person.
        email="" if order else (email or ""),
        # Recorded, never acted on here. Publishing stays a staff decision;
        # a name is how someone would be credited if it happens, not an
        # agreement that it should.
        display_name=(display_name or "").strip()[:80],
    )

    # §9 — every submission, as it arrives.
    #
    # Sent AFTER the row is committed, so an alert never describes feedback
    # that was not actually stored. `send_alert` never raises (see its
    # module docstring), so Telegram being down cannot turn a customer's
    # submission into an error for them.
    #
    # The message is included verbatim rather than summarised: the whole
    # value of an instant alert is reading what they actually wrote. It is
    # truncated because Telegram rejects very long messages, and a rejected
    # alert is worse than a clipped one.
    stars = f"{feedback.rating}/5" if feedback.rating is not None else "no rating"
    note = (feedback.message or "").strip()

    # An email address for the alert — NOT the same thing as
    # `Feedback.email`, which stays blank for an order-tied submission on
    # purpose (see the `Feedback.objects.create()` call above). The alert
    # is free to be more useful than the stored row: for an order-tied
    # submission there is a real address to reply to, `order.guest_email`
    # — already loaded on `order` (no extra query, no `order.customer`
    # relationship traversal needed), captured at the moment the order was
    # placed. For a general submission it is whatever was directly typed
    # in, already sitting on `feedback.email`.
    #
    # Wrapped defensively: this runs AFTER the feedback row is already
    # committed, so a failure here must never surface as an error on a
    # successful submission — `send_alert`'s own "never raises" guarantee
    # (its module docstring) only covers the network call inside it, not
    # string-building in this caller, which happens before `send_alert` is
    # ever reached.
    try:
        alert_email = order.guest_email if order else feedback.email
    except Exception:
        alert_email = ""

    send_alert(
        "FEEDBACK\n"
        f"{stars}\n"
        f"product: {product.slug if product else '—'}\n"
        f"order: {order.id if order else '— (general)'}\n"
        f"email: {alert_email or '—'}\n"
        f"{note[:600] if note else '(no message)'}"
    )

    return feedback
