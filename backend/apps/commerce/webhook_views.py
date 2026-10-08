"""
Public Paddle webhook endpoint. No guest session, no CSRF token — but
every request must carry a valid Paddle signature or it is rejected
before touching the database at all.

CRITICAL (Paddle's own documented requirement): signature verification
needs the *exact* raw bytes of the request body. `request.body` is read
here before anything else touches the request, and `parser_classes = []`
prevents DRF from parsing/re-serializing the body first — no
`json.dumps(json.loads(raw_body))`, no whitespace normalization, no
DRF content negotiation, nothing between the wire and the signature
check. The JSON payload is only parsed (via `parse_webhook_payload`,
plain `json.loads` on the same untouched bytes) *after* verification
succeeds.
"""

import logging

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from django.conf import settings

from apps.common.exceptions.api_errors import (
    FreemiusNotEnabled,
    FreemiusWebhookSignatureInvalid,
    InvalidFastSpringWebhook,
    InvalidFreemiusWebhook,
    InvalidPaddleWebhook,
    FastSpringWebhookSignatureInvalid,
    PaddleWebhookSignatureInvalid,
)

from .fastspring_integration import ORDER_COMPLETED_EVENT as FASTSPRING_ORDER_COMPLETED_EVENT
from .fastspring_integration import parse_webhook_payload as parse_fastspring_webhook_payload
from .fastspring_integration import verify_webhook_signature as verify_fastspring_webhook_signature
from .freemius_integration import (
    LICENSE_CREATED_EVENT,
    PAYMENT_CREATED_EVENT,
    parse_webhook_payload as parse_freemius_webhook_payload,
    verify_webhook_signature as verify_freemius_webhook_signature,
)
from .paddle_integration import TRANSACTION_PAID_EVENT, parse_webhook_payload, verify_webhook_signature
from apps.common.telegram import send_alert

from .services import confirm_fastspring_webhook_payment, confirm_freemius_webhook_payment, confirm_paddle_webhook_payment

logger = logging.getLogger("heartfolio")


class PaddleWebhookView(APIView):
    # Explicitly empty rather than left at DRF's default
    # (SessionAuthentication + BasicAuthentication) — this endpoint
    # authenticates nobody, unambiguously. (Even DRF's default would
    # end up equivalent here — an anonymous request never triggers
    # SessionAuthentication's CSRF check, per the same DRF quirk noted
    # in apps/customers/authentication.py — but there's no reason to
    # rely on that for a public, unauthenticated endpoint.)
    authentication_classes = []
    permission_classes = [AllowAny]
    # This view reads and verifies the raw body itself; DRF must not
    # attempt to parse it first.
    parser_classes = []

    def post(self, request):
        raw_body = request.body  # read before anything else — see module docstring

        try:
            # request._request is the underlying Django HttpRequest,
            # which directly satisfies the small Protocol
            # (body: bytes, headers.get()) the Paddle SDK's Verifier
            # expects.
            verified = verify_webhook_signature(request._request, raw_body)
        except Exception:
            logger.error("paddle_webhook_verification_error")
            verified = False

        if not verified:
            logger.warning("paddle_webhook_signature_rejected")
            raise PaddleWebhookSignatureInvalid()

        try:
            event = parse_webhook_payload(raw_body)
        except ValueError as exc:
            logger.error("paddle_webhook_malformed_payload")
            raise InvalidPaddleWebhook(str(exc))

        logger.info(
            "paddle_webhook_received",
            extra={"event_type": event.event_type, "transaction_id": event.transaction_id},
        )

        if event.event_type != TRANSACTION_PAID_EVENT:
            # Accepted (200) but ignored — this MVP only acts on
            # transaction.paid. Returning success for events we
            # intentionally don't handle avoids Paddle retrying
            # something that was never going to be processed.
            return Response({"status": "ignored"}, status=status.HTTP_200_OK)

        try:
            confirm_paddle_webhook_payment(event)  # raises a structured ApplicationError on any reconciliation failure
        except Exception as exc:
            """§9 — a payment that cannot be verified is the other alert.

            One place, at the boundary, rather than at each of the five
            reconciliation branches inside `confirm_paddle_webhook_payment`.
            Alerting per branch would mean a new check added later silently
            not alerting, which is the failure mode an alerting system can
            least afford.

            Money has moved and the order has not been marked paid: the
            customer has been charged and has nothing. That is worth a phone
            buzzing at any hour, which is precisely what §9 is for.

            Re-raised unchanged — the existing error handling below still
            decides the HTTP response, and Paddle's retry behaviour must not
            change because an alert was sent.
            """
            send_alert(
                "PAYMENT NOT VERIFIED\n"
                f"transaction: {event.transaction_id}\n"
                f"order: {event.order_id}\n"
                f"reason: {exc}\n\n"
                "The customer may have been charged without receiving their order."
            )
            raise

        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class FastSpringWebhookView(APIView):
    """Public FastSpring webhook endpoint — direct sibling of
    `PaddleWebhookView` above, same authentication/permission/raw-body
    discipline, adapted for one real difference: FastSpring can batch
    multiple events into a single delivery (`{"events": [...]}`), where
    every Paddle delivery this codebase has seen carries exactly one.

    Each event in the batch is processed independently; a non-
    `order.completed` event is logged and ignored, same rule as Paddle's
    non-`transaction.paid` events. If any `order.completed` event in the
    batch fails reconciliation, this re-raises (aborting the rest of the
    batch) rather than swallowing it — safe specifically because
    `confirm_fastspring_webhook_payment` is idempotent, so FastSpring
    retrying the whole batch later just no-ops on whatever was already
    successfully processed.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = []

    def post(self, request):
        raw_body = request.body  # read before anything else — see module docstring

        try:
            verified = verify_fastspring_webhook_signature(request._request, raw_body)
        except Exception:
            logger.error("fastspring_webhook_verification_error")
            verified = False

        if not verified:
            logger.warning("fastspring_webhook_signature_rejected")
            raise FastSpringWebhookSignatureInvalid()

        try:
            events = parse_fastspring_webhook_payload(raw_body)
        except ValueError as exc:
            logger.error("fastspring_webhook_malformed_payload")
            raise InvalidFastSpringWebhook(str(exc))

        for event in events:
            logger.info(
                "fastspring_webhook_received",
                extra={"event_type": event.event_type, "order_id": event.order_id},
            )

            if event.event_type != FASTSPRING_ORDER_COMPLETED_EVENT:
                # Accepted, logged, ignored — this integration only acts on
                # order.completed, same rule as Paddle's transaction.paid.
                continue

            try:
                confirm_fastspring_webhook_payment(event)  # raises a structured ApplicationError on any reconciliation failure
            except Exception as exc:
                # §9 — same alert Paddle's webhook sends on an unverified
                # payment; see PaddleWebhookView's own comment for the full
                # reasoning. Re-raised unchanged.
                send_alert(
                    "PAYMENT NOT VERIFIED (FastSpring)\n"
                    f"fastspring reference: {event.fastspring_reference}\n"
                    f"order: {event.order_id}\n"
                    f"reason: {exc}\n\n"
                    "The customer may have been charged without receiving their order."
                )
                raise

        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class FreemiusWebhookView(APIView):
    """Public Freemius webhook endpoint — the safety net for a customer
    whose browser never got to call `/checkout/freemius/complete/` (see
    `services.py::confirm_freemius_webhook_payment`'s own docstring for
    why this can only do a bounded best-effort match rather than a
    deterministic lookup — Freemius's checkout has no passthrough field).

    Same raw-body-first, `parser_classes = []` discipline as the other
    two webhook views, and the same signature-before-anything-else
    ordering.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = []

    def post(self, request):
        if not settings.FREEMIUS_ENABLED:
            raise FreemiusNotEnabled()

        raw_body = request.body  # read before anything else

        try:
            verified = verify_freemius_webhook_signature(raw_body, request.headers.get("x-signature"))
        except Exception:
            logger.error("freemius_webhook_verification_error")
            verified = False

        if not verified:
            logger.warning("freemius_webhook_signature_rejected")
            raise FreemiusWebhookSignatureInvalid()

        try:
            event = parse_freemius_webhook_payload(raw_body)
        except ValueError as exc:
            logger.error("freemius_webhook_malformed_payload")
            raise InvalidFreemiusWebhook(str(exc))

        logger.info(
            "freemius_webhook_received",
            extra={"event_type": event.event_type, "license_id": event.license_id},
        )

        if event.event_type not in (PAYMENT_CREATED_EVENT, LICENSE_CREATED_EVENT):
            # Accepted (200) but ignored — same rule as Paddle/FastSpring:
            # only act on the one event that means "money moved."
            return Response({"status": "ignored"}, status=status.HTTP_200_OK)

        # confirm_freemius_webhook_payment never raises for the
        # "couldn't find exactly one candidate" case — it alerts and
        # returns (see its own docstring). It only raises if a match WAS
        # found but verification then failed, which is the same
        # "money moved, order didn't" case the other two providers alert
        # on — already handled (and alerted) inside that function itself,
        # so this view doesn't duplicate the alert the way the other two
        # views do.
        confirm_freemius_webhook_payment(event)

        return Response({"status": "ok"}, status=status.HTTP_200_OK)
