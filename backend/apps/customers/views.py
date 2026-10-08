"""
Guest identity endpoint: `GET/POST /api/v1/guest/`.

Not a customer CRUD API — there is exactly one resource ("the current
guest") and it's always resolved from the request's own session, never
from a client-supplied id. A request can never read or modify another
customer's data through this endpoint, because the customer is looked up
solely from `request.session`, which is server-side and tied to the
caller's own session cookie.

Identity flow:

- `GET` returns the guest identity already associated with this
  session, if any (`{"customerId": null, "email": null}` if none yet).
  It also forces Django to issue a CSRF cookie (`get_token`), so a
  frontend can call this once on load to obtain the token it needs to
  send with the subsequent `POST`, without requiring a customer or
  session to exist yet — this deliberately does *not* create a
  `Customer` row or a persisted session for a purely anonymous visit
  (see the module-level note in `models.py` and the Phase 3.2 report on
  why `customers.email` being `NOT NULL` means there is nothing to
  persist before an email is known).
- `POST {"email": "..."}` resolves-or-creates the `Customer` for that
  email and stores its id in the session, from that point identifying
  the caller across requests via the session cookie alone.
"""

import logging

from django.middleware.csrf import get_token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import CsrfEnforcedSessionAuthentication
from .serializers import CustomerPublicSerializer, GuestEmailInputSerializer
from .services import SESSION_CUSTOMER_ID_KEY, get_customer_by_id, get_or_create_guest_customer

logger = logging.getLogger("heartfolio")


class GuestIdentityView(APIView):
    # No Django auth user exists for a guest — IsAuthenticated (the
    # project-wide DRF default) would reject every request here.
    permission_classes = [AllowAny]
    # Plain SessionAuthentication only enforces CSRF for an authenticated
    # Django auth user, which guests never are — this variant enforces it
    # unconditionally so the POST below stays CSRF-protected.
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    # Phase 3.14: the POST here can create a new Customer row per
    # unique email with no account/verification step — the natural
    # target for a spam/enumeration script. See REST_FRAMEWORK's
    # DEFAULT_THROTTLE_RATES for the actual per-environment rate.
    throttle_scope = "guest_identity"

    def get(self, request):
        # Guarantees a CSRF cookie is present for the frontend to read
        # before it ever needs to POST, without requiring any session
        # data to be written yet.
        get_token(request)

        customer = self._resolve_customer(request)
        if customer is None:
            return Response({"customerId": None, "email": None})
        return Response(self._serialize(customer))

    def post(self, request):
        input_serializer = GuestEmailInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        email = input_serializer.validated_data["email"]

        customer, created = get_or_create_guest_customer(email)
        request.session[SESSION_CUSTOMER_ID_KEY] = str(customer.id)

        logger.info(
            "guest_identity_resolved",
            extra={"customer_created": created},
        )

        return Response(self._serialize(customer))

    def _resolve_customer(self, request):
        customer_id = request.session.get(SESSION_CUSTOMER_ID_KEY)
        if not customer_id:
            return None

        customer = get_customer_by_id(customer_id)
        if customer is None:
            # Stale/invalid reference (e.g. data changed out from under
            # an old session) — drop it rather than keep resolving to
            # nothing on every request.
            del request.session[SESSION_CUSTOMER_ID_KEY]
        return customer

    @staticmethod
    def _serialize(customer) -> dict:
        data = CustomerPublicSerializer(customer).data
        return {"customerId": str(data["id"]), "email": data["email"]}
