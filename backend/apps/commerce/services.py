"""
Commerce service layer: order creation, payment confirmation, and
entitlement generation. This is the only place that touches
`Order`/`Payment`/`Entitlement` business rules — views only validate
input shape and call into here.
"""

from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction

from apps.common.exceptions.api_errors import (
    DeliveryPackDisabled,
    DeliveryPackNotFound,
    FreemiusNotEnabled,
    FreemiusPlanNotConfigured,
    FreemiusStagingAccessDenied,
    FreemiusStagingExpired,
    FreemiusStagingNotFound,
    FreemiusVerificationFailed,
    OrderAccessDenied,
    OrderNotFound,
    OrderNotPayable,
    PaymentAmountMismatch,
    PaymentFailed,
    PaymentTransactionNotFound,
    PaymentVerificationFailed,
    ProjectProductMismatch,
)
from apps.common.telegram import send_alert
from apps.products.models import DeliveryPack
from apps.products.services import get_product_by_slug
from apps.projects.services import get_project_for_customer

from .emails import send_order_confirmation
from .order_access import verify_order_access_token
from .models import Entitlement, FreemiusCheckoutStaging, Order, Payment
from .fastspring_integration import FastSpringCheckoutResult, FastSpringWebhookEvent
from .paddle_integration import PaddleCheckoutResult, PaddleWebhookEvent
from .payment_provider import PaymentProvider, get_payment_provider
from . import freemius_integration

logger = logging.getLogger("heartfolio")


def _resolve_and_validate_order_inputs(customer, *, product_slug: str, delivery_pack_slug: str, project_id):
    """The product/pack/project resolution and validation shared by
    `create_order` and `stage_freemius_checkout` — every check that must
    happen before ANY money changes hands, regardless of which provider
    eventually confirms payment. Extracted so the two callers can never
    drift apart on what "a valid thing to buy" means.

    Returns `(product, delivery_pack, project)`.
    """
    product = get_product_by_slug(product_slug)  # raises ProductNotFound

    # Scoping the lookup to (product=product, slug=...) means a pack
    # slug that belongs to a *different* product simply doesn't match —
    # the product/pack mismatch case from the spec is enforced
    # structurally by this query, not by a separate consistency check.
    try:
        delivery_pack = DeliveryPack.objects.get(product=product, slug=delivery_pack_slug)
    except DeliveryPack.DoesNotExist as exc:
        raise DeliveryPackNotFound() from exc

    if delivery_pack.status != DeliveryPack.STATUS_ACTIVE:
        raise DeliveryPackDisabled()

    project = None
    if project_id is not None:
        # Ownership is enforced inside get_project_for_customer — a
        # project belonging to another guest raises ProjectAccessDenied
        # before we ever get here.
        project = get_project_for_customer(customer, project_id)
        if project.product_id != product.id:
            raise ProjectProductMismatch()

        # Defense in depth: reject a project the renderer would refuse to
        # deliver, before any payment step exists for it. This used to be
        # checked only at download time — after the customer had already
        # paid — because `ProjectRenderer.render()`'s own validation was
        # the only gate. A project can reach here with e.g. a milestone
        # photo that was never actually uploaded (see the frontend's
        # `uploadPendingMedia` fix for how that could happen at all), and
        # nothing before this point inspects `values`/`themeSelections` at
        # all.
        #
        # Deferred import: matches this module's own convention below
        # (`grant_entitlements`'s `from apps.delivery.models import
        # PublicExperience`) rather than a module-level import, since
        # `apps.delivery` importing back from `apps.commerce` elsewhere
        # (models.py, services.py, ar_views.py, ...) makes the safe
        # direction worth keeping deliberate rather than assumed.
        #
        # Reuses the renderer's OWN validator rather than a second copy of
        # its rules — `validate_project_data` is optional (see
        # `apps.delivery.renderers.ProductRenderer`'s docstring): a product
        # with no renderer, or a renderer that hasn't opted in, is simply
        # not checked here. As of this change that is every registered
        # renderer (Love Story Timeline, Song Poster, Where We Met Map/
        # `heart-map`, and Reasons I Love You, which is live-only and is
        # registered FOR this check alone) except Star Map, which has no
        # renderer registered at all and is therefore unconditionally
        # undeliverable regardless of this check.
        from apps.delivery.registry import get_renderer

        renderer = get_renderer(product.slug, "")
        validate_project_data = getattr(renderer, "validate_project_data", None)
        if validate_project_data is not None:
            validate_project_data(
                project.data.get("values", {}), project.data.get("themeSelections", {})
            )

    return product, delivery_pack, project


def create_order(
    customer,
    *,
    product_slug: str,
    delivery_pack_slug: str,
    project_id=None,
    locale: str | None = None,
) -> Order:
    """Resolves product/pack/project from frontend-friendly identifiers,
    validates the combination, and computes pricing entirely
    server-side — the frontend never gets to supply a price.
    """
    product, delivery_pack, project = _resolve_and_validate_order_inputs(
        customer, product_slug=product_slug, delivery_pack_slug=delivery_pack_slug, project_id=project_id
    )

    subtotal_cents = delivery_pack.price_cents
    discount_cents = 0  # MVP: no discount codes/logic yet
    total_cents = subtotal_cents - discount_cents

    return Order.objects.create(
        customer=customer,
        project=project,
        product=product,
        delivery_pack=delivery_pack,
        guest_email=customer.email,
        # Recorded once, at purchase. Later language switches must not
        # retroactively change what a delivered keepsake says it is, or
        # what language a receipt was sent in.
        locale=locale or settings.DEFAULT_LOCALE,
        currency=delivery_pack.currency,
        subtotal_cents=subtotal_cents,
        discount_cents=discount_cents,
        total_cents=total_cents,
    )


def get_order_by_access_token(order_id, token: str) -> Order:
    """Resolves an order from a magic-link token instead of a session (§12).

    Scoped to exactly this order. A valid token for order A gets you nowhere
    with order B, because `verify_order_access_token` checks the id inside
    the signature against the id being requested — it is not a login and
    confers nothing about the customer's other purchases.

    Both a bad token and a missing order raise `OrderNotFound`, the same
    error a stranger guessing ids would get. Distinguishing them would
    confirm which order ids exist.
    """
    if not verify_order_access_token(token, order_id=order_id):
        raise OrderNotFound()

    try:
        return Order.objects.select_related(
            "product", "delivery_pack", "project"
        ).prefetch_related("payments").get(id=order_id)
    except (Order.DoesNotExist, ValueError, TypeError):
        raise OrderNotFound()


def get_order_for_customer(customer, order_id) -> Order:
    try:
        order = Order.objects.select_related("product", "delivery_pack", "project").prefetch_related("payments").get(
            id=order_id
        )
    except (Order.DoesNotExist, ValueError, TypeError):
        raise OrderNotFound()

    if order.customer_id != customer.id:
        raise OrderAccessDenied()

    return order


def grant_entitlements(order: Order) -> None:
    """One Entitlement per `delivery_pack.included_targets` entry.
    Idempotent via `get_or_create` on the approved (order_id, target_id)
    uniqueness constraint — calling this twice for the same order never
    creates duplicates or raises.
    """
    # §7 — promoting provisional video/audio assets happens here, in the
    # same transaction as entitlement granting, for the same reason
    # `PublicExperience` provisioning does: a separate step would be a
    # second place for a paid order to end up half-provisioned. Idempotent
    # by construction — re-running an UPDATE that clears an already-NULL
    # `expires_at` does nothing on a redelivered webhook.
    from apps.commerce.media_promotion import promote_media_assets_for_order

    promote_media_assets_for_order(order)

    for target_id in order.delivery_pack.included_targets or []:
        entitlement, _ = Entitlement.objects.get_or_create(
            order=order,
            target_id=target_id,
            defaults={"product": order.product},
        )

        # §21h — an AR target gets its persistent access row in the SAME
        # step that grants the entitlement, from the same verified webhook.
        # No new event, no new hook: a separate step would be a second place
        # for a paid order to end up half-provisioned, which is the exact
        # failure the lookup screen (§9) exists to find.
        #
        # `get_or_create` keeps this idempotent alongside the entitlement
        # above — a redelivered webhook must not mint a second URL, because
        # the first one may already be printed on something.
        # §21h / §10 — a hosted experience gets its permanent access row in
        # the SAME verified step that grants the entitlement. Both AR and
        # the live keepsake need one; `kind` is what tells them apart.
        from apps.delivery.models import PublicExperience

        if target_id.startswith("ar-"):
            PublicExperience.objects.get_or_create(
                entitlement=entitlement, defaults={"kind": PublicExperience.KIND_AR}
            )
        elif target_id == "__live__":
            PublicExperience.objects.get_or_create(
                entitlement=entitlement, defaults={"kind": PublicExperience.KIND_LIVE}
            )


def confirm_payment(customer, order_id, *, provider: PaymentProvider | None = None):
    """Locks the order, invokes the payment provider, and — on success,
    in the same transaction — marks the order paid and grants
    entitlements. Returns `(order, payment)`.

    Concurrency: `select_for_update()` means a second simultaneous
    confirmation for the same order blocks until the first transaction
    commits, then observes the already-`paid` status and takes the
    idempotent-return branch below rather than charging twice.

    A failed payment is persisted (the transaction still commits) but
    does *not* change the order's status — the order stays payable for
    a retry. `PaymentFailed` is raised only after the transaction has
    already committed, so raising it doesn't undo the just-recorded
    failed Payment row.
    """
    provider = provider or get_payment_provider()
    payment_succeeded = None
    payment = None

    with transaction.atomic():
        try:
            order = Order.objects.select_for_update().select_related("product", "delivery_pack").get(id=order_id)
        except (Order.DoesNotExist, ValueError, TypeError):
            raise OrderNotFound()

        if order.customer_id != customer.id:
            raise OrderAccessDenied()

        if order.status == Order.STATUS_PAID:
            # Prefer an idempotent response over another charge attempt.
            existing_payment = order.payments.filter(status=Payment.STATUS_SUCCESS).order_by("-created_at").first()
            return order, existing_payment

        if order.status == Order.STATUS_CANCELLED:
            raise OrderNotPayable()

        result = provider.pay(order)

        payment = Payment.objects.create(
            order=order,
            provider=getattr(provider, "id", "mock"),
            provider_reference=result.reference,
            amount_cents=order.total_cents,
            currency=order.currency,
            status=Payment.STATUS_SUCCESS if result.status == "success" else Payment.STATUS_FAILED,
        )
        payment_succeeded = payment.status == Payment.STATUS_SUCCESS

        if payment_succeeded:
            order.status = Order.STATUS_PAID
            order.save(update_fields=["status", "updated_at"])
            grant_entitlements(order)

    if payment_succeeded is False:
        raise PaymentFailed(details={"paymentId": str(payment.id)})

    return order, payment


# ------------------------------------------------------------------
# Paddle (asynchronous) checkout + webhook confirmation
# ------------------------------------------------------------
# These are new, separate code paths from `confirm_payment` above,
# which is completely unmodified and remains the entire story for
# `MockPaymentProvider` (see payment_provider.py's `synchronous` flag —
# apps/commerce/views.py branches on it before calling either path).


def start_checkout_for_order(customer, order_id, *, provider: PaymentProvider | None = None):
    """The asynchronous counterpart to `confirm_payment`: begins a
    Paddle checkout rather than completing a charge synchronously.
    Returns `(order, checkout_result_or_None, reused_payment_or_None)`
    — exactly one of the last two is non-None, except in the
    already-paid case where both are None and the order alone reflects
    the outcome.

    Retry/duplicate-checkout handling (see the Phase 3.7 report for the
    full reasoning):
    - already paid -> return the existing successful payment, no new
      Paddle transaction.
    - cancelled -> OrderNotPayable.
    - an existing *pending* Payment for this provider already has a
      transaction reference -> reuse that reference as-is rather than
      creating a new Paddle transaction on every repeated checkout
      open. This does not re-verify the transaction is still open on
      Paddle's side (no extra API call) — if it has actually expired,
      Paddle Checkout will fail client-side and the customer retrying
      lands back on this same code path, which will then create a
      fresh transaction because the prior Payment can be superseded
      (see the Payment.STATUS_FAILED marking below on retry).
    - otherwise -> create a new Paddle transaction and a `pending`
      Payment referencing it.
    """
    provider = provider or get_payment_provider()

    with transaction.atomic():
        try:
            order = Order.objects.select_for_update().select_related("product", "delivery_pack").get(id=order_id)
        except (Order.DoesNotExist, ValueError, TypeError):
            raise OrderNotFound()

        if order.customer_id != customer.id:
            raise OrderAccessDenied()

        if order.status == Order.STATUS_PAID:
            existing_payment = order.payments.filter(status=Payment.STATUS_SUCCESS).order_by("-created_at").first()
            return order, None, existing_payment

        if order.status == Order.STATUS_CANCELLED:
            raise OrderNotPayable()

        reusable_payment = (
            order.payments.filter(provider=provider.id, status=Payment.STATUS_PENDING)
            .order_by("-created_at")
            .first()
        )
        if reusable_payment and reusable_payment.provider_reference:
            return order, _checkout_result_from_payment(reusable_payment), None

        checkout_result = provider.start_checkout(order)
        # Branches on which provider this is — PaddleCheckoutResult and
        # FastSpringCheckoutResult carry the provider's own reference under
        # different field names (`transaction_id` vs `session_id`), the
        # same reason `_checkout_result_from_payment` below has to branch
        # going the other direction (Payment -> checkout result).
        provider_reference = (
            checkout_result.session_id if provider.id == "fastspring" else checkout_result.transaction_id
        )
        Payment.objects.create(
            order=order,
            provider=provider.id,
            provider_reference=provider_reference,
            amount_cents=order.total_cents,
            currency=order.currency,
            status=Payment.STATUS_PENDING,
        )
        return order, checkout_result, None


def _checkout_result_from_payment(payment: Payment) -> PaddleCheckoutResult | FastSpringCheckoutResult:
    """Rebuilds the active provider's own checkout-result shape from an
    existing PENDING payment being reused (see `start_checkout_for_order`'s
    own docstring on why a repeated checkout-open reuses rather than
    recreates). Must branch on `payment.provider` — this used to always
    build a `PaddleCheckoutResult` unconditionally, which was correct while
    Paddle was the only asynchronous provider but would hand
    `OrderPayView.post()`'s new `provider.id == "fastspring"` branch a
    result object with no `session_id`/`checkout_url` on a reused
    FastSpring checkout, crashing with an AttributeError instead of
    reopening it.

    `checkout_url` is `None` on a FastSpring reuse — only the session id
    (`provider_reference`) is persisted, not the original checkout URL.
    The Store Builder Library popup only needs the session id to reopen;
    `checkout_url` is a redirect fallback that simply isn't available on
    this path. Paddle's own reuse already accepts an analogous
    simplification (`status="reused"` rather than the real original
    status) — this is the same kind of already-accepted gap, not a new
    class of one.
    """
    if payment.provider == "fastspring":
        return FastSpringCheckoutResult(session_id=payment.provider_reference, checkout_url=None)
    return PaddleCheckoutResult(transaction_id=payment.provider_reference, status="reused")


def confirm_paddle_webhook_payment(event: PaddleWebhookEvent) -> None:
    """The webhook-triggered counterpart to `confirm_payment`'s
    "success" branch. No `customer`/session context exists here — the
    order is resolved solely from `event.order_id` (Paddle's
    `custom_data.orderId`, set at transaction-creation time in
    `paddle_integration.create_transaction`), never from email, amount,
    or product name.

    Amount/currency reconciliation happens *before* anything is
    mutated: if Paddle's reported total or currency doesn't match the
    order's authoritative values, this raises `PaymentAmountMismatch`
    and neither the order nor any Payment is touched — no mismatched
    purchase is ever silently granted.

    Idempotent: relies on the same `(order_id, target_id)` and
    `(provider, provider_reference)` database constraints
    `confirm_payment`/`grant_entitlements` already rely on, plus
    `select_for_update()` locking, so redelivering the same
    `transaction.paid` event twice is safe — see
    apps/commerce/tests.py's webhook idempotency tests.
    """
    if not event.order_id:
        raise PaymentTransactionNotFound()

    with transaction.atomic():
        try:
            order = (
                Order.objects.select_for_update()
                .select_related("product", "delivery_pack")
                .get(id=event.order_id)
            )
        except (Order.DoesNotExist, ValueError, TypeError):
            raise PaymentTransactionNotFound()

        if order.status == Order.STATUS_PAID:
            logger.info(
                "paddle_webhook_duplicate_delivery",
                extra={"order_id": str(order.id), "transaction_id": event.transaction_id},
            )
            return  # already handled by an earlier delivery of this (or an equivalent) event — nothing to do

        # Reconcile currency and amount against the order's
        # authoritative total *before* mutating anything.
        if event.currency_code != order.currency:
            logger.error(
                "paddle_webhook_currency_mismatch",
                extra={"order_id": str(order.id), "transaction_id": event.transaction_id},
            )
            raise PaymentAmountMismatch("Webhook currency does not match the order's currency.")

        try:
            reported_total_cents = int(event.total_cents)
        except (TypeError, ValueError):
            logger.error(
                "paddle_webhook_malformed_total",
                extra={"order_id": str(order.id), "transaction_id": event.transaction_id},
            )
            raise PaymentAmountMismatch("Webhook total could not be parsed.")

        if reported_total_cents != order.total_cents:
            logger.error(
                "paddle_webhook_amount_mismatch",
                extra={"order_id": str(order.id), "transaction_id": event.transaction_id},
            )
            raise PaymentAmountMismatch("Webhook amount does not match the order's total.")

        # Idempotent lookup: a Payment for this exact Paddle transaction
        # reference may already exist (created by start_checkout_for_order,
        # left pending) — reuse and update it rather than creating a
        # second row, which the (provider, provider_reference) unique
        # constraint would reject anyway on a raw create(). select_for_update()
        # here (in addition to the Order lock above) closes a race where two
        # webhook deliveries for the same transaction_id could otherwise both
        # pass the mismatch check below before either commits.
        payment, _created = Payment.objects.select_for_update().get_or_create(
            provider="paddle",
            provider_reference=event.transaction_id,
            defaults={
                "order": order,
                "amount_cents": reported_total_cents,
                "currency": event.currency_code,
                "status": Payment.STATUS_PENDING,
            },
        )

        # get_or_create() only matches on (provider, provider_reference) —
        # it does NOT verify the found row belongs to the order this event's
        # custom_data.orderId resolved to. Without this check, a Payment
        # already associated with a different order (e.g. stale/duplicated
        # transaction data) would be silently reused: this order would be
        # marked paid and granted entitlements while the actual Payment row
        # stays attached to the other order — a data-integrity break, not
        # merely a display issue. Reject instead of silently reconciling.
        if payment.order_id != order.id:
            logger.error(
                "paddle_webhook_transaction_order_mismatch",
                extra={
                    "order_id": str(order.id),
                    "transaction_id": event.transaction_id,
                    "existing_payment_order_id": str(payment.order_id),
                },
            )
            raise PaymentVerificationFailed(
                "This Paddle transaction is already associated with a different order."
            )

        payment.status = Payment.STATUS_SUCCESS
        payment.amount_cents = reported_total_cents
        payment.save(update_fields=["status", "amount_cents", "updated_at"])

        order.status = Order.STATUS_PAID
        # §7a — Paddle's own country record, stored at the moment of truth.
        update_fields = ["status", "updated_at"]
        if event.country_code and not order.buyer_country:
            order.buyer_country = event.country_code.upper()[:2]
            update_fields.append("buyer_country")
        order.save(update_fields=update_fields)
        grant_entitlements(order)

    logger.info(
        "paddle_webhook_payment_confirmed",
        extra={"order_id": str(order.id), "transaction_id": event.transaction_id},
    )

    # §12 — the receipt, with its magic link.
    #
    # Sent AFTER the atomic block closes, deliberately. Inside it, an HTTP
    # call to Resend would hold a row lock on the order open for the whole
    # round trip, and a slow provider would serialize concurrent webhooks
    # behind it. Worse, a send that succeeded inside a transaction that then
    # rolled back would email a customer about an order that does not exist.
    #
    # Outside, the ordering is the safe one: the order is durably paid and
    # its entitlements granted before any email is attempted, so the failure
    # mode is a missing receipt for a working order rather than a receipt for
    # a broken one. `send_order_confirmation` never raises — see its module
    # docstring.
    send_order_confirmation(order)

    # §9 — the good-news alert.
    #
    # Sent last, and deliberately after the receipt: an alert is worth less
    # than the customer's own email, so it must never delay or precede it.
    # `send_alert` never raises and never retries (see its module
    # docstring), so a Telegram outage cannot affect an order that is
    # already durably paid by this point.
    #
    # Worth knowing: this is a blocking HTTP call with a 10s timeout inside
    # the Paddle webhook request. Paddle retries webhooks that time out,
    # and this handler is idempotent, so the failure mode is a duplicate
    # delivery attempt rather than a lost payment — but it is the reason
    # not to add alerts indiscriminately to hot paths.
    send_alert(
        "PAID\n"
        f"order: {order.id}\n"
        f"product: {order.product.slug if order.product_id else '—'}\n"
        f"pack: {order.delivery_pack.slug if order.delivery_pack_id else '—'}\n"
        f"total: {order.total_cents / 100:.2f} {order.currency}\n"
        f"country: {order.buyer_country or '—'}"
    )


def _cents_from_fastspring_total(value: str | None) -> int:
    """FastSpring reports order totals as a decimal dollar string
    ("15.99"), confirmed against the Sessions API's own request/response
    shape — unlike Paddle, which sends a minor-unit string ("1200"). See
    `FastSpringWebhookEvent.total`'s own docstring in
    fastspring_integration.py for why the field isn't named `total_cents`.
    Decimal, not float, for the same reason `create_session`'s own
    `_price_string` avoids float division. Raises `TypeError`/
    `InvalidOperation` on anything unparseable — the caller treats that
    identically to Paddle's malformed-total case (`PaymentAmountMismatch`,
    nothing mutated).
    """
    if value is None:
        raise TypeError("No total to parse.")
    return int((Decimal(value) * 100).to_integral_value(rounding=ROUND_HALF_UP))


# ------------------------------------------------------------------
# FastSpring (asynchronous) checkout + webhook confirmation
# ------------------------------------------------------------------
# Direct sibling of the Paddle block above — same structure, same
# reconciliation discipline, a second provider. `confirm_paddle_webhook_payment`
# above is completely unmodified; this does not replace it or share a
# code path with it, only the shape.


def confirm_fastspring_webhook_payment(event: FastSpringWebhookEvent) -> None:
    """The webhook-triggered counterpart to `confirm_payment`'s "success"
    branch, for FastSpring. No `customer`/session context exists here —
    the order is resolved solely from `event.order_id` (FastSpring's
    `data.tags.orderId`, set at session-creation time in
    `fastspring_integration.create_session`), never from FastSpring's own
    order id/reference, email, amount, or product name.

    LIVE-FLAG RECONCILIATION, BEFORE ANYTHING ELSE THAT ORDER LOOKUP
    ONWARD DOES. FastSpring runs one store with a single credential pair
    serving both test and live activity — confirmed directly, no separate
    sandbox account the way Paddle has — so `event.live` is the only
    signal distinguishing a real payment from a test one. A mismatch
    against `settings.FASTSPRING_ENVIRONMENT` is rejected before the order
    is even looked up, the same "reconcile before you mutate" discipline
    the amount/currency checks below apply once inside the transaction.

    Amount/currency reconciliation happens *before* anything is mutated:
    if FastSpring's reported total or currency doesn't match the order's
    authoritative values, this raises `PaymentAmountMismatch` and neither
    the order nor any Payment is touched — same rule as Paddle. This is a
    backstop, not the primary defence: `create_session`'s own `pricing`
    override is what should make a real mismatch unlikely in practice; this
    check is what happens if that assumption is ever wrong.

    NO BUYER-COUNTRY CAPTURE, unlike the Paddle branch's `buyer_country`
    handling (§7a) — no FastSpring order.completed payload has actually
    been received and inspected yet (see the "UNCONFIRMED" warning on
    `parse_webhook_payload`), so there is no confirmed field to read one
    from. Deliberately omitted rather than guessed at; add it once a real
    field name is confirmed against a sandbox event, the same way Paddle's
    was added from an actual observed payload.

    Idempotent: relies on the same `(order_id, target_id)` and
    `(provider, provider_reference)` database constraints
    `confirm_payment`/`grant_entitlements` already rely on, plus
    `select_for_update()` locking — identical idempotency guarantee to
    Paddle's webhook handling, applied to a second provider.
    """
    if not event.order_id:
        raise PaymentTransactionNotFound()

    if event.live != (settings.FASTSPRING_ENVIRONMENT == "production"):
        logger.error(
            "fastspring_webhook_live_flag_mismatch",
            extra={
                "order_id": event.order_id,
                "event_live": event.live,
                "fastspring_environment": settings.FASTSPRING_ENVIRONMENT,
            },
        )
        raise PaymentVerificationFailed(
            "FastSpring event's live flag does not match the configured environment."
        )

    with transaction.atomic():
        try:
            order = (
                Order.objects.select_for_update()
                .select_related("product", "delivery_pack")
                .get(id=event.order_id)
            )
        except (Order.DoesNotExist, ValueError, TypeError):
            raise PaymentTransactionNotFound()

        if order.status == Order.STATUS_PAID:
            logger.info(
                "fastspring_webhook_duplicate_delivery",
                extra={"order_id": str(order.id), "fastspring_reference": event.fastspring_reference},
            )
            return  # already handled by an earlier delivery of this (or an equivalent) event — nothing to do

        # Reconcile currency and amount against the order's authoritative
        # total *before* mutating anything.
        if event.currency_code != order.currency:
            logger.error(
                "fastspring_webhook_currency_mismatch",
                extra={"order_id": str(order.id), "fastspring_reference": event.fastspring_reference},
            )
            raise PaymentAmountMismatch("Webhook currency does not match the order's currency.")

        try:
            reported_total_cents = _cents_from_fastspring_total(event.total)
        except (TypeError, ValueError, InvalidOperation):
            logger.error(
                "fastspring_webhook_malformed_total",
                extra={"order_id": str(order.id), "fastspring_reference": event.fastspring_reference},
            )
            raise PaymentAmountMismatch("Webhook total could not be parsed.")

        if reported_total_cents != order.total_cents:
            logger.error(
                "fastspring_webhook_amount_mismatch",
                extra={"order_id": str(order.id), "fastspring_reference": event.fastspring_reference},
            )
            raise PaymentAmountMismatch("Webhook amount does not match the order's total.")

        if not event.fastspring_reference:
            # No FastSpring-side id to key a Payment row on at all — see
            # the "UNCONFIRMED" warning on parse_webhook_payload. Rejected
            # rather than falling back to event.order_id (our OWN id),
            # which would make provider_reference meaningless as "the
            # provider's own reference to this transaction".
            logger.error("fastspring_webhook_missing_reference", extra={"order_id": str(order.id)})
            raise PaymentTransactionNotFound()

        # Idempotent lookup: a Payment for this exact FastSpring reference
        # may already exist (created by start_checkout_for_order, left
        # pending) — reuse and update it rather than creating a second row,
        # which the (provider, provider_reference) unique constraint would
        # reject anyway on a raw create(). select_for_update() here (in
        # addition to the Order lock above) closes a race where two webhook
        # deliveries for the same reference could otherwise both pass the
        # mismatch check below before either commits.
        payment, _created = Payment.objects.select_for_update().get_or_create(
            provider="fastspring",
            provider_reference=event.fastspring_reference,
            defaults={
                "order": order,
                "amount_cents": reported_total_cents,
                "currency": event.currency_code,
                "status": Payment.STATUS_PENDING,
            },
        )

        # Same data-integrity guard as the Paddle branch: get_or_create()
        # only matches on (provider, provider_reference), never verifies
        # the found row belongs to the order this event's orderTags
        # resolved to.
        if payment.order_id != order.id:
            logger.error(
                "fastspring_webhook_transaction_order_mismatch",
                extra={
                    "order_id": str(order.id),
                    "fastspring_reference": event.fastspring_reference,
                    "existing_payment_order_id": str(payment.order_id),
                },
            )
            raise PaymentVerificationFailed(
                "This FastSpring order is already associated with a different Heartfolio order."
            )

        payment.status = Payment.STATUS_SUCCESS
        payment.amount_cents = reported_total_cents
        payment.save(update_fields=["status", "amount_cents", "updated_at"])

        order.status = Order.STATUS_PAID
        order.save(update_fields=["status", "updated_at"])
        grant_entitlements(order)

    logger.info(
        "fastspring_webhook_payment_confirmed",
        extra={"order_id": str(order.id), "fastspring_reference": event.fastspring_reference},
    )

    # §12 — the receipt, with its magic link. Same ordering rule as
    # Paddle's own version above: sent AFTER the atomic block closes, so a
    # slow Resend round trip never holds the order's row lock open, and a
    # send that "succeeded" inside a transaction that then rolled back
    # can never email a customer about an order that does not exist.
    # `send_order_confirmation` never raises — see its module docstring.
    send_order_confirmation(order)

    # §9 — the good-news alert, same reasoning as Paddle's: sent last,
    # after the receipt, never raises, never retries.
    send_alert(
        "PAID (FastSpring)\n"
        f"order: {order.id}\n"
        f"product: {order.product.slug if order.product_id else '—'}\n"
        f"pack: {order.delivery_pack.slug if order.delivery_pack_id else '—'}\n"
        f"total: {order.total_cents / 100:.2f} {order.currency}\n"
        f"fastspring reference: {event.fastspring_reference or '—'}"
    )


# ------------------------------------------------------------------
# Freemius (sandbox review build) — staged checkout, no pre-existing Order
# ------------------------------------------------------------------
# Freemius's checkout has no passthrough field (see
# freemius_integration.py's module docstring) — there is nothing to
# resolve a webhook back to a pending Order by, so no Order exists until
# a real payment is verified. `FreemiusCheckoutStaging` holds everything
# create_order() would otherwise apply immediately.
#
# Two ways a staging row gets completed:
#   - complete_freemius_checkout(): the frontend's own call, right after
#     the checkout overlay reports success. Primary path — covers the
#     overwhelming common case, since the overlay never navigates the
#     browser away from Heartfolio.
#   - confirm_freemius_webhook_payment(): the safety net, for the rare
#     case the browser never got to report back. Cannot identify a
#     specific staging row directly (no passthrough), so it does a
#     bounded best-effort match and refuses to guess when that match
#     isn't exactly one row.
# Both funnel into _complete_freemius_purchase(), which is the only
# place that actually verifies a purchase and creates the Order.

FREEMIUS_STAGING_TTL_SECONDS = 60 * 60  # 1 hour — see FreemiusCheckoutStaging.expires_at


def stage_freemius_checkout(
    customer,
    *,
    product_slug: str,
    delivery_pack_slug: str,
    project_id=None,
    locale: str | None = None,
) -> FreemiusCheckoutStaging:
    """The Freemius counterpart to `create_order` — same validation
    (`_resolve_and_validate_order_inputs`), but the result is held, not
    applied. Also resolves the pack's configured Freemius plan/pricing
    up front: a pack with none configured cannot be staged at all,
    rather than staging something that could never actually complete.
    """
    if not settings.FREEMIUS_ENABLED:
        raise FreemiusNotEnabled()

    product, delivery_pack, project = _resolve_and_validate_order_inputs(
        customer, product_slug=product_slug, delivery_pack_slug=delivery_pack_slug, project_id=project_id
    )

    if freemius_integration.plan_for_pack(product.slug, delivery_pack.slug) is None:
        raise FreemiusPlanNotConfigured()

    from django.utils import timezone

    return FreemiusCheckoutStaging.objects.create(
        customer=customer,
        product=product,
        delivery_pack=delivery_pack,
        project=project,
        guest_email=customer.email,
        locale=locale or settings.DEFAULT_LOCALE,
        currency=delivery_pack.currency,
        expected_total_cents=delivery_pack.price_cents,
        expires_at=timezone.now() + timezone.timedelta(seconds=FREEMIUS_STAGING_TTL_SECONDS),
    )


def get_freemius_staging_for_customer(customer, staging_id) -> FreemiusCheckoutStaging:
    """Ownership-checked lookup for the polling endpoint — mirrors
    `get_order_for_customer`'s own shape.
    """
    try:
        staging = FreemiusCheckoutStaging.objects.select_related("resulting_order").get(id=staging_id)
    except (FreemiusCheckoutStaging.DoesNotExist, ValueError, TypeError):
        raise FreemiusStagingNotFound()
    if staging.customer_id != customer.id:
        raise FreemiusStagingAccessDenied()
    return staging


def _complete_freemius_purchase(staging: FreemiusCheckoutStaging, license_id: str) -> Order:
    """The one place that verifies a Freemius purchase and creates the
    Order — shared by both the frontend-driven path and the webhook
    safety net, so they can never verify differently.

    Re-fetches the license (never trusts a browser-supplied one) and, if
    it isn't cancelled, the associated payment, then cross-checks BOTH
    the plan/pricing and the amount against what this specific staging
    row was created for. Without that cross-check, a real, previously-
    legitimate license_id (from a different, cheaper purchase) could be
    resubmitted against a staging row for a pricier pack and pass a
    bare "is this a real, paid license" test without matching what was
    supposed to be bought.

    Idempotent via the same (provider, provider_reference) unique
    constraint every other provider's webhook already relies on
    (`uq_payments_provider_reference`) — whichever caller gets here
    first with a given license_id wins; a second call for the same
    license_id (redelivered webhook, or the webhook racing the
    frontend's own call) finds the staging row already `completed` and
    returns its `resulting_order` rather than creating a second one.
    """
    from django.utils import timezone

    # A SEPARATE, COMMITTING transaction, deliberately not folded into the
    # one below: raising from inside an atomic block rolls back everything
    # that block did, including a status change made moments earlier in
    # the same block — marking a row `expired` and then raising within the
    # same `with transaction.atomic()` would silently undo the mark. Doing
    # it here, in its own transaction that returns normally either way,
    # means the expiry actually persists before this function ever raises.
    with transaction.atomic():
        staging = FreemiusCheckoutStaging.objects.select_for_update().get(id=staging.id)
        if staging.status == FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT and staging.expires_at < timezone.now():
            staging.status = FreemiusCheckoutStaging.STATUS_EXPIRED
            staging.save(update_fields=["status", "updated_at"])

    if staging.status == FreemiusCheckoutStaging.STATUS_COMPLETED:
        logger.info(
            "freemius_purchase_duplicate_delivery",
            extra={"staging_id": str(staging.id), "license_id": license_id},
        )
        return staging.resulting_order

    if staging.status != FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT:
        raise FreemiusStagingExpired()

    with transaction.atomic():
        staging = FreemiusCheckoutStaging.objects.select_for_update().select_related(
            "product", "delivery_pack", "customer"
        ).get(id=staging.id)

        # Idempotency check BEFORE creating anything, not via
        # get_or_create() the way Paddle/FastSpring's webhooks do —
        # `Payment.order` is NOT NULL, so (unlike those two, whose
        # Payment already exists in `pending` against an already-created
        # Order and just gets updated in place) the Order/Payment pair
        # here has to be created together, atomically, the first time
        # only. A second arrival for the same license_id — the webhook
        # safety net racing the frontend's own call, or a redelivered
        # webhook — finds it here and returns the existing order rather
        # than reaching the create calls below at all.
        existing_payment = (
            Payment.objects.select_for_update()
            .filter(provider="freemius", provider_reference=license_id)
            .select_related("order")
            .first()
        )
        if existing_payment is not None:
            if staging.status != FreemiusCheckoutStaging.STATUS_COMPLETED:
                staging.status = FreemiusCheckoutStaging.STATUS_COMPLETED
                staging.resulting_order = existing_payment.order
                staging.save(update_fields=["status", "resulting_order", "updated_at"])
            return existing_payment.order

        try:
            license_ = freemius_integration.get_license(license_id)
        except freemius_integration.FreemiusApiError as exc:
            raise FreemiusVerificationFailed("Could not verify this license with Freemius.") from exc

        if license_.is_cancelled:
            raise FreemiusVerificationFailed("This license has been cancelled.")

        # LIVE MEANS LIVE (25 Oct 2026). A sandbox purchase is a real-looking
        # licence that cost nothing; once the store is live it must never
        # mint a paid order. Before go-live both are accepted, since sandbox
        # checkouts are how the store is tested. A licence that does not say
        # is refused too: Freemius documents `environment` on every licence,
        # so its absence is not a production purchase we can vouch for.
        if settings.FREEMIUS_LIVE_CONFIRMED and license_.environment != freemius_integration.ENVIRONMENT_PRODUCTION:
            logger.error(
                "freemius_non_production_license_refused",
                extra={"staging_id": str(staging.id), "license_id": license_id, "environment": license_.environment},
            )
            raise FreemiusVerificationFailed("This license is not a live purchase.")

        # The cross-check that makes re-fetching the license worth doing:
        # a real, previously-legitimate license_id (from a DIFFERENT,
        # cheaper purchase) must not be resubmittable against a staging
        # row for a pricier pack. Matching on plan_id AND pricing_id is
        # more precise than an amount comparison would be (two different
        # packs can legitimately share a price; they cannot share a
        # pricing_id), so no separate Payment-amount fetch is needed.
        expected_plan = freemius_integration.plan_for_pack(staging.product.slug, staging.delivery_pack.slug)
        plan_matches = (
            expected_plan is not None
            and license_.plan_id == expected_plan["plan_id"]
            and (expected_plan.get("pricing_id") is None or license_.pricing_id == expected_plan["pricing_id"])
        )
        if not plan_matches:
            logger.error(
                "freemius_purchase_plan_mismatch",
                extra={"staging_id": str(staging.id), "license_id": license_id, "plan_id": license_.plan_id},
            )
            raise FreemiusVerificationFailed("This license does not match the plan for what was being bought.")

        order = Order.objects.create(
            customer=staging.customer,
            project=staging.project,
            product=staging.product,
            delivery_pack=staging.delivery_pack,
            guest_email=staging.guest_email,
            locale=staging.locale,
            currency=staging.currency,
            subtotal_cents=staging.expected_total_cents,
            discount_cents=0,
            total_cents=staging.expected_total_cents,
            status=Order.STATUS_PAID,
        )

        Payment.objects.create(
            order=order,
            provider="freemius",
            provider_reference=license_id,
            amount_cents=staging.expected_total_cents,
            currency=staging.currency,
            status=Payment.STATUS_SUCCESS,
        )

        grant_entitlements(order)

        staging.status = FreemiusCheckoutStaging.STATUS_COMPLETED
        staging.resulting_order = order
        staging.save(update_fields=["status", "resulting_order", "updated_at"])

    logger.info(
        "freemius_purchase_confirmed",
        extra={"staging_id": str(staging.id), "license_id": license_id, "order_id": str(order.id)},
    )
    send_order_confirmation(order)
    send_alert(
        f"PAID (Freemius, {freemius_integration.environment_label(license_.environment)})\n"
        f"order: {order.id}\n"
        f"product: {order.product.slug if order.product_id else '—'}\n"
        f"pack: {order.delivery_pack.slug if order.delivery_pack_id else '—'}\n"
        f"total: {order.total_cents / 100:.2f} {order.currency}\n"
        f"license: {license_id}"
    )
    return order


def complete_freemius_checkout(customer, staging_id, license_id: str) -> Order:
    """The frontend-driven completion path — called right after the
    checkout overlay's `success`/`purchaseCompleted` callback hands back
    a `license_id`. That callback is a lookup key, not proof (see
    freemius_integration.py's module docstring); this is the server-side
    verification that makes it trustworthy.
    """
    staging = get_freemius_staging_for_customer(customer, staging_id)
    return _complete_freemius_purchase(staging, license_id)


def confirm_freemius_webhook_payment(event) -> None:
    """The safety net for a customer whose browser never got to call
    `complete_freemius_checkout` (closed/crashed the instant after
    paying). Cannot identify a specific staging row directly — Freemius's
    webhook carries no passthrough reference — so this does a bounded,
    best-effort match instead of guessing:

    `guest_email` (case-insensitively) + `status=awaiting_payment` +
    created within the last hour. Exactly one match completes the same
    way the frontend path does. Zero or more than one match is NOT
    resolved automatically — logged and alerted for manual
    reconciliation, same `send_alert` path every other unverifiable-
    payment case in this codebase already uses. This is the one place
    email-adjacent matching is used at all, and it is deliberately
    narrow: a redelivered event for an already-`completed` staging row
    (the overwhelmingly common case) is caught by the license_id
    idempotency check inside `_complete_freemius_purchase` before this
    matching logic ever runs.
    """
    from django.utils import timezone
    from .models import FreemiusCheckoutStaging as Staging

    if not event.license_id:
        logger.warning("freemius_webhook_missing_license_id", extra={"event_type": event.event_type})
        return

    # Already handled (by the frontend path, or an earlier delivery of
    # this same event) — no-op, matching every other provider's webhook
    # idempotency check.
    if Payment.objects.filter(provider="freemius", provider_reference=event.license_id).exists():
        logger.info("freemius_webhook_duplicate_delivery", extra={"license_id": event.license_id})
        return

    if not event.user_email:
        send_alert(
            "FREEMIUS PAYMENT COULD NOT BE MATCHED (no email in webhook)\n"
            f"license: {event.license_id}\n"
            f"payment: {event.payment_id}\n"
            "Needs manual reconciliation."
        )
        return

    cutoff = timezone.now() - timezone.timedelta(seconds=FREEMIUS_STAGING_TTL_SECONDS)
    candidates = list(
        Staging.objects.filter(
            status=Staging.STATUS_AWAITING_PAYMENT,
            guest_email__iexact=event.user_email,
            created_at__gte=cutoff,
        )
    )

    if len(candidates) != 1:
        send_alert(
            "FREEMIUS PAYMENT COULD NOT BE MATCHED "
            f"({len(candidates)} candidate staging rows)\n"
            f"license: {event.license_id}\n"
            f"payment: {event.payment_id}\n"
            f"email: {event.user_email}\n"
            "The customer may have been charged without receiving their order. "
            "Needs manual reconciliation."
        )
        return

    try:
        _complete_freemius_purchase(candidates[0], event.license_id)
    except Exception as exc:
        send_alert(
            "FREEMIUS PAYMENT NOT VERIFIED (webhook safety net)\n"
            f"license: {event.license_id}\n"
            f"payment: {event.payment_id}\n"
            f"email: {event.user_email}\n"
            f"reason: {exc}\n\n"
            "The customer may have been charged without receiving their order."
        )
        raise
