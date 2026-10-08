from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.exceptions.api_errors import CustomerIdentityRequired
from apps.customers.authentication import CsrfEnforcedSessionAuthentication
from apps.customers.services import get_current_customer

from .serializers import FeedbackCreateInputSerializer, FeedbackSerializer
from .services import FeedbackOrderNotFound, create_feedback


def _session_customer(request):
    """The guest `Customer` for this session, or None if there isn't one.

    `get_current_customer` raises (401) when no identity exists, which is
    correct for endpoints that require one and wrong here — this endpoint
    also serves the unauthenticated general mode.
    """
    try:
        return get_current_customer(request)
    except CustomerIdentityRequired:
        return None


class FeedbackCreateView(APIView):
    """`POST /feedback/` — the only public endpoint this app exposes (§7c).

    There is deliberately no list or detail endpoint. Submissions are a
    private inbox read through Django admin; an API that returned them, even
    scoped, would be one misconfigured permission away from publishing
    customer writing that was never meant to be public.

    THROTTLED, because the general mode accepts submissions with no
    authentication at all — that is the point of it, and it is also an open
    invitation to anyone who wants to fill the inbox with noise.
    """

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "feedback_create"

    def post(self, request):
        serializer = FeedbackCreateInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            feedback = create_feedback(
                rating=data["rating"],
                message=data.get("message", ""),
                order_id=data.get("orderId"),
                token=data.get("token", ""),
                email=data.get("email", ""),
                display_name=data.get("displayName", ""),
                # Resolved leniently and ONLY for the order-tied mode: the
                # general mode is deliberately open to people with no
                # session at all, so a missing identity must not turn into
                # a 401 here. When there is no session and no valid token,
                # `create_feedback` refuses the order anyway.
                customer=_session_customer(request) if data.get("orderId") else None,
            )
        except FeedbackOrderNotFound:
            return Response(
                {"detail": "That order could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(FeedbackSerializer(feedback).data, status=status.HTTP_201_CREATED)
