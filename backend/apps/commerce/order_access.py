"""Signed, expiring, order-scoped access tokens (§12).

WHY THESE EXIST
---------------
A receipt email that links to `/orders/<id>` only works if the customer
reopens it in the same browser that still holds their guest session cookie.
Open it on a phone instead of a laptop, or after clearing cookies, and they
are locked out of an order they paid for — which defeats the point of
emailing the link at all. This is the "customer lost their download" gap.

WHAT A TOKEN IS, AND IS NOT
---------------------------
It grants read access to exactly one order, and to downloading that order's
entitlements. It is not a login, it creates no account, and it confers
nothing about any other order the same customer may have placed. Holding a
token for order A tells you nothing and gets you nowhere with order B.

That scoping is deliberate: the alternative — a token that authenticates the
*customer* — would turn a forwarded receipt email into full access to
someone's purchase history.

MECHANISM
---------
Django's `TimestampSigner`, keyed on `SECRET_KEY`. No new dependency, no
token table to store or clean up, and no revocation list — the signature
proves the token was issued by this server and the timestamp proves when.
An attacker cannot mint one without the secret key, and cannot alter the
order id inside one without invalidating the signature.

The salt namespaces these against every other use of the same secret, so a
token minted for some future purpose can never be replayed as an order
token.

EXPIRY
------
30 days by default. Long enough that a customer who files the email away and
comes back a few weeks later still gets their files; short enough that a
receipt sitting in a long-abandoned inbox does not stay live forever. When a
token does expire the customer is not stuck — the order still exists, and a
fresh link can be issued.
"""

from __future__ import annotations

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner

#: Namespaces these tokens against any other signed value in this project.
ORDER_ACCESS_SALT = "heartfolio.order-access"


def _signer() -> TimestampSigner:
    return TimestampSigner(salt=ORDER_ACCESS_SALT)


def generate_order_access_token(order_id) -> str:
    """Mints a token granting access to one order."""
    return _signer().sign(str(order_id))


def verify_order_access_token(token: str, *, order_id) -> bool:
    """True only if `token` was issued by this server, for this exact order,
    and has not expired.

    Returns a boolean rather than raising, because every failure mode —
    forged, tampered, expired, for a different order — leads to the same
    outcome for the caller, and distinguishing them in an API response would
    tell an attacker which part of their guess was wrong.
    """
    if not token:
        return False

    try:
        unsigned = _signer().unsign(token, max_age=settings.ORDER_ACCESS_TOKEN_MAX_AGE_DAYS * 86400)
    except (BadSignature, SignatureExpired):
        return False

    # Compared as strings: `order_id` arrives as a UUID from the model and as
    # a str from the URL, and `UUID("...") != "..."` is silently False.
    return unsigned == str(order_id)
