"""
All Freemius-specific code lives in this module, mirroring
`paddle_integration.py`'s own boundary — nothing else in the codebase
imports `requests` for Freemius directly.

NOT a `PaymentProvider` subclass (see `payment_provider.py`). That
interface's `start_checkout(order)` takes an *existing* `Order`, and
Freemius's checkout has no equivalent of Paddle's `custom_data` — no
field anywhere in Freemius's checkout options, redirect payload, or
webhook payload lets us attach our own reference and get it back
(confirmed against the full published OpenAPI spec — `License`,
`Payment`, `Customer`, and the webhook's own `objects` wrapper all have
closed field sets; the only `external_id` fields that exist are
Freemius's own reference *into* the gateway, not a field exposed to us).
So there is nothing to resolve a webhook back to a specific `Order`
*before one exists* — which is why, for Freemius only, the `Order` is
created after payment is verified, not before. See
`services.py::stage_freemius_checkout` /
`complete_freemius_checkout` / `confirm_freemius_webhook_payment`,
and `FreemiusCheckoutStaging` in models.py.

REST API is plain Bearer-token HTTP/JSON
(https://freemius.com/help/documentation/api/) — no SDK, matching the
"hand-rolled, no skill automation" decision. Uses the `requests`
library already in requirements/base.txt.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger("heartfolio")

FREEMIUS_API_BASE = "https://api.freemius.com/v1"

#: Freemius wraps every purchase — subscription or one-off — in a
#: `payment.created` event; `license.created` fires alongside it. Either
#: is a valid trigger for the webhook path; `payment.created` is used
#: since it's the more direct "money moved" signal (mirrors choosing
#: `transaction.paid` over `transaction.completed` for Paddle).
PAYMENT_CREATED_EVENT = "payment.created"
LICENSE_CREATED_EVENT = "license.created"


class FreemiusConfigurationError(Exception):
    """Freemius is enabled but required configuration is missing."""


#: Maps a Heartfolio (product_slug, delivery_pack_slug) pair to the
#: Freemius Plan/Pricing that must be created in the Developer Dashboard
#: for it (§"Setting Up Freemius Plans" in their own docs — one-off/
#: lifetime pricing per pack, not subscription plans). EMPTY until real
#: Freemius plans exist; a pack with no entry here cannot be staged
#: (see `plan_for_pack` below) rather than silently checking out against
#: the wrong (or a nonexistent) plan.
FREEMIUS_PLAN_MAPPING: dict[str, dict[str, str]] = {
    # Sandbox review E2E test only — Love Story Timeline "Digital" ($15.99,
    # DB pack slug "live", see seed_catalog.py). No pricing_id: this plan
    # has a single price point in Freemius, so plan_id alone is precise
    # (see plan_matches in services.py — pricing_id is only cross-checked
    # when present in the mapping).
    "love-story-timeline:live": {"plan_id": "69404"},
    # Printable ($22.99) and Complete ($39.99) — same single-price-point
    # shape as Digital, so plan_id alone is precise. Prices confirmed equal
    # to DeliveryPack.price_cents; the completion amount cross-check would
    # reject a mismatch. The wallpaper combo packs (`printable-plus-wallpaper`,
    # `digital-plus-wallpaper`) have NO plan on purpose — the "Add
    # wallpapers" checkbox that would select them is hidden (see
    # `SHOW_WALLPAPER_ADDON` in the frontend's lib/feature-flags.ts).
    "love-story-timeline:printable": {"plan_id": "70517"},
    # `complete` is RETIRED (its pack is disabled, so it can no longer be
    # staged) but stays mapped: plan 70518 is what past Complete licenses were
    # sold on, and it must keep meaning "Complete". Never rename or retarget it
    # in the Freemius dashboard for a new product — create a new plan instead.
    "love-story-timeline:complete": {"plan_id": "70518"},
    # Printable + Digital ($35.99) — its OWN plan, created new in the dashboard,
    # single price point, so plan_id alone is precise like the others. Plan 70543.
    "love-story-timeline:printable-plus-digital": {"plan_id": "70543"},
    # Reasons I Love You's only pack, Digital ($15.99, DB pack slug "live";
    # live-only product). Its OWN plan, created new under the same Freemius
    # product as the plans above, single price point, so plan_id alone is
    # precise. Plan 71990.
    "reasons-i-love-you:live": {"plan_id": "71990"},
    # Graduation Keepsake's only pack, Digital ($15.99, DB pack slug "live";
    # live-only product). Its OWN plan, created new under the same Freemius
    # product, single price point, so plan_id alone is precise. Plan 72194.
    "graduation-keepsake:live": {"plan_id": "72194"},
}


def plan_for_pack(product_slug: str, delivery_pack_slug: str) -> dict[str, str] | None:
    return FREEMIUS_PLAN_MAPPING.get(f"{product_slug}:{delivery_pack_slug}")


def _api_headers() -> dict[str, str]:
    if not settings.FREEMIUS_API_TOKEN:
        raise FreemiusConfigurationError("FREEMIUS_API_TOKEN is not configured.")
    return {"Authorization": f"Bearer {settings.FREEMIUS_API_TOKEN}", "Accept": "application/json"}


class FreemiusApiError(Exception):
    """Wraps any Freemius REST/network failure, so callers don't need to
    know about `requests.RequestException` specifically.
    """


def _get(path: str) -> dict[str, Any]:
    if not settings.FREEMIUS_PRODUCT_ID:
        raise FreemiusConfigurationError("FREEMIUS_PRODUCT_ID is not configured.")
    url = f"{FREEMIUS_API_BASE}/products/{settings.FREEMIUS_PRODUCT_ID}{path}"
    try:
        response = requests.get(url, headers=_api_headers(), timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.error("freemius_api_request_failed", extra={"path": path})
        raise FreemiusApiError() from exc
    return response.json()


@dataclass(frozen=True)
class FreemiusLicense:
    id: str
    plan_id: str
    pricing_id: str | None
    user_id: str
    is_cancelled: bool


def get_license(license_id: str) -> FreemiusLicense:
    """`GET /products/{id}/licenses/{license_id}.json` — the
    authoritative record. Never trust a `license_id` a browser handed us
    without this call; see the module docstring on why the checkout
    callback is a lookup key, not proof.

    `plan_id`/`pricing_id` are what `services.py::_complete_freemius_
    purchase` cross-checks against the staging row's own expected pack —
    more precise than an amount comparison would be (two different packs
    can legitimately share a price; they cannot share a pricing_id), so
    there is deliberately no separate "fetch the payment for its amount"
    call here.
    """
    data = _get(f"/licenses/{license_id}.json")
    return FreemiusLicense(
        id=str(data["id"]),
        plan_id=str(data["plan_id"]),
        pricing_id=str(data["pricing_id"]) if data.get("pricing_id") is not None else None,
        user_id=str(data["user_id"]),
        is_cancelled=bool(data.get("is_cancelled", False)),
    )


def get_sandbox_params(product_id: str, secret_key: str, public_key: str) -> dict[str, str]:
    """Mirrors `@freemius/sdk`'s `Checkout.getSandboxParams()` exactly —
    read directly from its published source
    (https://github.com/Freemius/freemius-js, `dist/index.js`):

        async getSandboxParams() {
            const timestamp = Math.floor(Date.now() / 1e3).toString();
            const token = `${timestamp}${productId}${this.secretKey}${this.publicKey}checkout`;
            return { ctx: timestamp, token: md5(token) };
        }

    No REST call involved — it's a pure, time-sensitive local computation,
    which is why this is called fresh per request (from
    `FreemiusStagingSerializer.get_sandbox`) rather than cached or read
    from a static setting. MD5 is Freemius's own scheme here, not a choice
    made by this codebase — this must match their checkout backend's own
    verification exactly, not some stronger substitute.
    """
    ctx = str(int(time.time()))
    token = hashlib.md5(f"{ctx}{product_id}{secret_key}{public_key}checkout".encode("utf-8")).hexdigest()
    return {"ctx": ctx, "token": token}


def verify_webhook_signature(raw_body: bytes, signature_header: str | None) -> bool:
    """Freemius's documented scheme
    (https://freemius.com/help/documentation/saas/events-webhooks/#validating-webhook-signatures):
    HMAC-SHA256 of the raw body, using the product's *secret key* (not
    the API bearer token — a different credential, per Settings -> API
    & Keys). Timing-safe compare, same discipline as Paddle's verifier.
    """
    if not settings.FREEMIUS_SECRET_KEY:
        raise FreemiusConfigurationError("FREEMIUS_SECRET_KEY is not configured.")
    if not signature_header:
        return False

    computed = hmac.new(
        settings.FREEMIUS_SECRET_KEY.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    try:
        return hmac.compare_digest(computed, signature_header)
    except (TypeError, ValueError):
        return False


@dataclass(frozen=True)
class FreemiusWebhookEvent:
    event_type: str
    license_id: str | None
    payment_id: str | None
    user_email: str | None


def parse_webhook_payload(raw_body: bytes) -> FreemiusWebhookEvent:
    """Parses the verified webhook body. Only called *after*
    `verify_webhook_signature` succeeds — see webhook_views.py.

    The payload's `objects` map carries whichever of
    `user`/`license`/`payment`/`subscription`/`install` are relevant to
    `type` — read defensively since not every event carries every key.
    """
    import json

    try:
        payload: dict[str, Any] = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise ValueError("Webhook payload is not valid JSON.") from exc

    objects = payload.get("objects") or {}
    license_obj = objects.get("license") or {}
    payment_obj = objects.get("payment") or {}
    user_obj = objects.get("user") or {}

    return FreemiusWebhookEvent(
        event_type=payload.get("type", ""),
        license_id=str(license_obj["id"]) if license_obj.get("id") is not None else None,
        payment_id=str(payment_obj["id"]) if payment_obj.get("id") is not None else None,
        user_email=user_obj.get("email"),
    )
