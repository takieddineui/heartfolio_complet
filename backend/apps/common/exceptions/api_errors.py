"""
Application-level errors for the Phase 3.4 API. Each class name, run
through `apps/common/exceptions/handlers.py`'s camelCase -> snake_case
conversion, produces exactly the stable error code the API contract
calls for (`ProductNotFound` -> "product_not_found") — there is no
separate code registry to keep in sync with these class names.

Kept in `common` because every domain app (`products`, `projects`,
`commerce`) needs some of these, and the alternative — each app
defining its own near-identical `NotFound`/`AccessDenied` exceptions —
would just be the same handful of HTTP-error shapes duplicated three
times.
"""

from rest_framework import status
from rest_framework.exceptions import APIException


class ApplicationError(APIException):
    """Base class for every named application error below. Accepts an
    optional `details` dict for structured extra context beyond the
    human-readable message (e.g. which id conflicted) — most errors
    don't need it and can rely on the message alone.
    """

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "An error occurred."
    default_code = "application_error"

    def __init__(self, detail=None, details=None):
        super().__init__(detail=detail)
        self.details = details or {}


# --- Identity -----------------------------------------------------

class CustomerIdentityRequired(ApplicationError):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "A guest identity is required for this request."


# --- Products -------------------------------------------------------

class ProductNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Product not found."


class ProductUnavailable(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This product is not currently available."


class DeliveryPackNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Delivery pack not found."


class DeliveryPackDisabled(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This delivery pack is not currently available."


# --- Projects ---------------------------------------------------------

class ProjectNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Project not found."


class ProjectAccessDenied(ApplicationError):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This project does not belong to the current guest."


class ProjectProductMismatch(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The project does not belong to the same product as this order."


class InvalidProjectData(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "Project data does not match the required structure."


# --- Orders / payments ----------------------------------------------

class OrderNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Order not found."


class OrderAccessDenied(ApplicationError):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This order does not belong to the current guest."


class OrderNotPayable(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This order can no longer be paid."


class PaymentFailed(ApplicationError):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    default_detail = "The payment attempt failed."


class PaymentAlreadyCompleted(ApplicationError):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This order has already been paid."


# --- Assets -----------------------------------------------------------

class AssetNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Asset not found."


class AssetAccessDenied(ApplicationError):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This asset does not belong to the current guest."


class MissingAssetFile(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "No file was uploaded."


class InvalidAssetType(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This file type is not supported."


class AssetTooLarge(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This file exceeds the maximum allowed size."


class AssetUploadFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "The asset could not be uploaded to storage."


class AssetDeleteFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "The asset could not be deleted from storage."


class AssetDownloadFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "The asset could not be read from storage."


# --- Payments (Paddle) --------------------------------------------

class PaymentProviderUnavailable(ApplicationError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The payment provider is currently unavailable."


class PaymentCreationFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "The payment could not be started."


class PaymentVerificationFailed(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The payment could not be verified."


class PaymentAmountMismatch(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The payment amount does not match the order total."


class PaymentTransactionNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "No matching order was found for this payment transaction."


class InvalidPaddleWebhook(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The webhook payload is malformed."


class PaddleWebhookSignatureInvalid(ApplicationError):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "The webhook signature could not be verified."


class InvalidFastSpringWebhook(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The webhook payload is malformed."


class FastSpringWebhookSignatureInvalid(ApplicationError):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "The webhook signature could not be verified."


class OrderPaymentNotOffered(ApplicationError):
    """PAYMENT_PROVIDER=freemius: orders are paid only through the Freemius
    checkout (`checkout/freemius/...`), so the generic pay endpoint has no
    provider behind it and refuses, rather than a 500."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "Orders are paid through the Freemius checkout."


class FreemiusNotEnabled(ApplicationError):
    status_code = status.HTTP_501_NOT_IMPLEMENTED
    default_detail = "Freemius checkout is not enabled."


class FreemiusPlanNotConfigured(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This pack has no Freemius plan configured yet."


class FreemiusStagingNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "No matching checkout was found."


class FreemiusStagingAccessDenied(ApplicationError):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This checkout does not belong to you."


class FreemiusStagingExpired(ApplicationError):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This checkout has expired. Please start again."


class FreemiusVerificationFailed(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This purchase could not be verified."


class InvalidFreemiusWebhook(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The webhook payload is malformed."


class FreemiusWebhookSignatureInvalid(ApplicationError):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "The webhook signature could not be verified."


# --- Delivery ---------------------------------------------------------

class EntitlementNotFound(ApplicationError):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Entitlement not found."


class EntitlementAccessDenied(ApplicationError):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This entitlement does not belong to the current guest."


class RendererNotAvailable(ApplicationError):
    status_code = status.HTTP_501_NOT_IMPLEMENTED
    default_detail = "This delivery is not available yet."


class UnsupportedDeliveryType(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This entitlement's delivery type is not supported."


# --- Product renderers (Love Story Timeline) --------------------------

class LoveStoryTimelineInvalidData(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This project's data does not match the Love Story Timeline contract."


class LoveStoryTimelineRenderFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "Love Story Timeline rendering failed."


# --- Product renderers (Song Poster) ------------------------------------

class SongPosterInvalidData(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This project's data does not match the Song Poster contract."


class SongPosterRenderFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "Song Poster rendering failed."


# --- Product renderers (Where We Met Map) ------------------------------

class WhereWeMetMapInvalidData(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This project's data does not match the Where We Met Map contract."


class WhereWeMetMapRenderFailed(ApplicationError):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "Where We Met Map rendering failed."


# --- Product data (Reasons I Love You, live-only: no renderer, no render error) ---

class ReasonsILoveYouInvalidData(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This project's data does not match the Reasons I Love You contract."


# --- Product data (Graduation Keepsake, live-only: no renderer, no render error) ---

class GraduationKeepsakeInvalidData(ApplicationError):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This project's data does not match the Graduation Keepsake contract."
