from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.customers.authentication import CsrfEnforcedSessionAuthentication
from apps.customers.services import get_current_customer
from django.conf import settings

from .serializers import (
    EntitlementSerializer,
    FreemiusCompleteInputSerializer,
    FreemiusStageInputSerializer,
    FreemiusStagingSerializer,
    OrderCreateInputSerializer,
    OrderSerializer,
    PaymentSerializer,
)
from .services import (
    complete_freemius_checkout,
    confirm_payment,
    create_order,
    get_freemius_staging_for_customer,
    get_order_by_access_token,
    get_order_for_customer,
    stage_freemius_checkout,
    start_checkout_for_order,
)
from .payment_provider import get_payment_provider


class OrderCreateView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    # Phase 3.14: order creation is cheap per-request but is the entry
    # point into the payment flow — throttled as a basic guard against
    # scripted order spam, independent of anything Paddle itself does.
    throttle_scope = "order_create"

    def post(self, request):
        customer = get_current_customer(request)

        input_serializer = OrderCreateInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        order = create_order(
            customer,
            product_slug=input_serializer.validated_data["productId"],
            delivery_pack_slug=input_serializer.validated_data["deliveryPackId"],
            project_id=input_serializer.validated_data.get("projectId"),
            locale=input_serializer.validated_data.get("locale"),
        )
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)


class OrderDetailView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def get(self, request, order_id, token=None):
        # §12 — a magic-link token is an alternative to the session cookie,
        # not an addition to it. The emailed link has to work on a phone that
        # has never seen this site, which is the entire reason the token
        # exists; requiring both would reproduce the problem it solves.
        # `token` is a URL kwarg now (path segment) — see urls.py.
        if token:
            order = get_order_by_access_token(order_id, token)
        else:
            customer = get_current_customer(request)
            order = get_order_for_customer(customer, order_id)
        return Response(OrderSerializer(order).data)


class OrderPayView(APIView):
    """Behavior branches on which payment provider is active
    (`settings.PAYMENT_PROVIDER`), never on anything request-supplied:

    - **Mock (synchronous)** — unchanged from Phase 3.4/3.6: calls
      `confirm_payment`, which completes the (mock) charge immediately
      and returns the final order/payment state in this same response.
      `checkout` is always `null` on this path.
    - **Paddle (asynchronous)** — calls `start_checkout_for_order`,
      which only creates/reuses a Paddle transaction. The response's
      `order.status` reflects the *current* state, which is still
      `"pending"` unless the order was already paid from an earlier,
      separate webhook delivery — this endpoint itself never marks an
      order paid when Paddle is active. `checkout.transactionId` is
      what the frontend hands to Paddle.js to open Checkout;
      `checkout.clientToken` is Paddle's public, non-secret client-side
      token (see paddle_integration.py's module docstring on the three
      distinct Paddle credential types — the secret API key and
      webhook secret are never included in any API response).
    - **FastSpring (asynchronous)** — same shape as Paddle, via
      `start_checkout_for_order` again (it is provider-agnostic; see
      services.py). `checkout.sessionId` is what the frontend hands to
      the Store Builder Library to open the popup;
      `checkout.checkoutUrl` is a redirect fallback;
      `checkout.accessKey` is FastSpring's public, non-secret
      client-side Store Builder key — same "backend is the single
      source of truth for which credential matches the active
      environment" reasoning `clientToken` already follows for Paddle,
      not a separate frontend-side env var. The secret API
      username/password and webhook secret are never included in any
      API response.

    The two async branches build genuinely different-shaped
    `checkout` payloads — `checkout_result` here is a
    `PaddleCheckoutResult` or a `FastSpringCheckoutResult` depending on
    which provider is active, and `provider.id` is what tells them
    apart. This is deliberately an explicit `if/elif`, not a generic
    "spread whatever fields the result object happens to have" — the
    response shape is a real API contract with the frontend, and a
    provider's internal result dataclass should not leak its fields
    into that contract by accident just because they happen to line up
    today.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def post(self, request, order_id):
        customer = get_current_customer(request)
        provider = get_payment_provider()

        if provider.synchronous:
            order, payment = confirm_payment(customer, order_id, provider=provider)
            return Response(
                {
                    "order": OrderSerializer(order).data,
                    "payment": PaymentSerializer(payment).data if payment else None,
                    "checkout": None,
                }
            )

        order, checkout_result, existing_payment = start_checkout_for_order(customer, order_id, provider=provider)
        checkout_payload = None
        if checkout_result is not None:
            if provider.id == "fastspring":
                checkout_payload = {
                    "provider": provider.id,
                    "sessionId": checkout_result.session_id,
                    "checkoutUrl": checkout_result.checkout_url,
                    "accessKey": settings.FASTSPRING_ACCESS_KEY,
                }
            else:
                checkout_payload = {
                    "provider": provider.id,
                    "transactionId": checkout_result.transaction_id,
                    "clientToken": settings.PADDLE_CLIENT_TOKEN,
                }
        return Response(
            {
                "order": OrderSerializer(order).data,
                "payment": PaymentSerializer(existing_payment).data if existing_payment else None,
                "checkout": checkout_payload,
            }
        )


class FreemiusStageView(APIView):
    """`POST /checkout/freemius/stage/` — the Freemius counterpart to
    `OrderCreateView`, but creates a `FreemiusCheckoutStaging` row
    instead of an `Order` (see services.py's module comment on why).
    Throttled the same way order creation is — same abuse shape.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "order_create"

    def post(self, request):
        customer = get_current_customer(request)

        input_serializer = FreemiusStageInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        staging = stage_freemius_checkout(
            customer,
            product_slug=input_serializer.validated_data["productId"],
            delivery_pack_slug=input_serializer.validated_data["deliveryPackId"],
            project_id=input_serializer.validated_data.get("projectId"),
            locale=input_serializer.validated_data.get("locale"),
        )
        return Response(FreemiusStagingSerializer(staging).data, status=status.HTTP_201_CREATED)


class FreemiusStagingDetailView(APIView):
    """`GET /checkout/freemius/stage/{id}/` — the frontend's fallback
    poll target for the rare case the checkout overlay's own callback
    never fires (see `waitForStagedOrder` on the frontend). `orderId` in
    the response is set only once `status === "completed"`.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def get(self, request, staging_id):
        customer = get_current_customer(request)
        staging = get_freemius_staging_for_customer(customer, staging_id)
        return Response(FreemiusStagingSerializer(staging).data)


class FreemiusCompleteView(APIView):
    """`POST /checkout/freemius/complete/` — called right after the
    checkout overlay's `success`/`purchaseCompleted` callback hands back
    a `license_id`. This is where that id is actually verified server-
    side (`services.py::complete_freemius_checkout`) — the callback
    itself is a lookup key, not proof.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def post(self, request):
        customer = get_current_customer(request)

        input_serializer = FreemiusCompleteInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        order = complete_freemius_checkout(
            customer,
            input_serializer.validated_data["stagingId"],
            input_serializer.validated_data["licenseId"],
        )
        return Response(OrderSerializer(order).data)


class OrderEntitlementsView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def get(self, request, order_id, token=None):
        # §12 — the order page lists deliverables before downloading any of
        # them, so this needs token access too or the emailed link opens a
        # page with nothing on it. `token` is a URL kwarg now — see urls.py.
        if token:
            order = get_order_by_access_token(order_id, token)
        else:
            customer = get_current_customer(request)
            order = get_order_for_customer(customer, order_id)
        entitlements = order.entitlements.all().order_by("target_id")
        return Response(
            {
                "orderId": str(order.id),
                "productId": order.product.slug,
                "entitlements": EntitlementSerializer(entitlements, many=True).data,
            }
        )
