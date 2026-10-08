"""Storing a compiled AR tracking target (§21i).

WHO IS ALLOWED TO WRITE HERE, AND WHY IT MATTERS
--------------------------------------------------
This is the one endpoint in the AR system that ACCEPTS data rather than
serving it, so it is the one where getting authorisation wrong has
consequences. A target is what the recipient's camera matches against: an
attacker who could overwrite someone else's would not steal anything, but
they could silently break a gift, which is its own kind of damage.

So the write is gated on the SAME ownership chain as every download:
session, customer, order, entitlement. The buyer compiling their own card at
checkout satisfies it; nobody else does. The AR id is deliberately NOT
accepted as a credential here — it is a bearer token for READING (§21f), and
letting it authorise a write would mean anyone who received a gift could
alter it.

WRITE ONCE. A target that already exists is not replaced. Compilation is
deterministic for a given card, so a second write is either a duplicate or
an attempt to change something, and neither is worth allowing.
"""

from __future__ import annotations

import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.assets.storage import get_asset_storage
from apps.commerce.models import Entitlement
from apps.customers.authentication import CsrfEnforcedSessionAuthentication
from apps.customers.services import get_current_customer
from apps.delivery.models import PublicExperience

logger = logging.getLogger("heartfolio")

#: A compiled `.mind` for one image is tens to low hundreds of kilobytes.
#: The ceiling is generous enough not to reject a legitimate one and tight
#: enough that this cannot be used as free storage.
MAX_TARGET_BYTES = 8 * 1024 * 1024


class ARTargetUploadView(APIView):
    """`POST /ar-targets/<entitlement_id>/` — store a compiled target."""

    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    throttle_scope = "ar_target_upload"

    def post(self, request, entitlement_id):
        customer = get_current_customer(request)

        try:
            entitlement = Entitlement.objects.select_related("order").get(
                id=entitlement_id, order__customer=customer
            )
        except (Entitlement.DoesNotExist, ValueError, TypeError):
            # Same shape of refusal as everywhere else: no distinction
            # between "not yours" and "does not exist".
            return Response(
                {"detail": "That item could not be found."}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            experience = entitlement.public_experience
        except PublicExperience.DoesNotExist:
            return Response(
                {"detail": "That item could not be found."}, status=status.HTTP_404_NOT_FOUND
            )

        if experience.target_key:
            # Write once — see the module docstring. Reported as success so
            # a retried upload after a flaky connection is not an error the
            # buyer has to understand.
            return Response({"status": "already-compiled"}, status=status.HTTP_200_OK)

        uploaded = request.FILES.get("target")
        if uploaded is None:
            return Response({"detail": "No target was uploaded."}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded.size > MAX_TARGET_BYTES:
            return Response({"detail": "That target is too large."}, status=status.HTTP_400_BAD_REQUEST)

        key = f"ar-targets/{experience.id}.mind"
        try:
            get_asset_storage().upload(key, uploaded, content_type="application/octet-stream")
        except Exception:  # noqa: BLE001
            logger.exception("ar_target_upload_failed", extra={"experience": str(experience.id)})
            return Response(
                {"detail": "The target could not be stored."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        experience.target_key = key
        experience.target_compiled_at = timezone.now()
        experience.save(update_fields=["target_key", "target_compiled_at", "updated_at"])

        return Response({"status": "stored"}, status=status.HTTP_201_CREATED)
