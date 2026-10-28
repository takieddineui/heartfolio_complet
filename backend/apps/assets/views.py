"""
Views stay thin: resolve the session customer, pull the file out of
`request.FILES`, delegate to `apps/assets/services.py`.
"""

from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.exceptions.api_errors import ApplicationError
from apps.common.telegram import send_alert
from apps.customers.authentication import CsrfEnforcedSessionAuthentication
from apps.customers.services import get_current_customer

from .serializers import AssetSerializer
from .services import delete_asset, generate_asset_access_url, get_asset_for_customer, upload_asset


class AssetUploadView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]
    parser_classes = [MultiPartParser]
    # Phase 3.14: every upload is a real R2 write (storage I/O + cost),
    # not just a cheap DB row — the natural rate-limiting target on
    # this view, distinct from the cheap GET/DELETE on AssetDetailView
    # below (left unthrottled).
    throttle_scope = "asset_upload"

    def post(self, request):
        customer = get_current_customer(request)
        uploaded_file = request.FILES.get("file")  # validated (incl. "missing") in the service layer
        # The product the upload is for: its folder in storage. Optional, so
        # an older cached Studio that does not send it still uploads.
        product_slug = request.data.get("product") or None

        try:
            asset = upload_asset(customer, uploaded_file, product_slug=product_slug)
        except ApplicationError:
            # An expected rejection — file too large, wrong type, missing.
            # The customer sees a clear message and can fix it themselves,
            # so alerting on these would mean a phone buzzing every time
            # someone picked a HEIC. Re-raised untouched.
            raise
        except Exception as exc:  # noqa: BLE001
            # §9 — anything else means R2 or the re-encode pipeline is
            # broken, which stops every customer mid-Studio and is
            # invisible until someone reads the logs. Alert, then re-raise
            # unchanged so the HTTP response and DRF's own error handling
            # are exactly what they were.
            send_alert(
                "ASSET UPLOAD FAILED\n"
                f"customer: {customer.id}\n"
                # The file's type, never its name: a customer's filename is
                # theirs and has no place in an alert (27 Oct 2026).
                f"type: {getattr(uploaded_file, 'content_type', '—')}\n"
                f"reason: {type(exc).__name__}: {exc}"
            )
            raise

        url = generate_asset_access_url(asset)

        return Response(AssetSerializer.from_asset(asset, url=url).data, status=status.HTTP_201_CREATED)


class AssetDetailView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def get(self, request, asset_id):
        customer = get_current_customer(request)
        asset = get_asset_for_customer(customer, asset_id)
        url = generate_asset_access_url(asset)
        return Response(AssetSerializer.from_asset(asset, url=url).data)

    def delete(self, request, asset_id):
        customer = get_current_customer(request)
        delete_asset(customer, asset_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
