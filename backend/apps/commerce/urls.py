from django.urls import path

from .views import (
    FreemiusCompleteView,
    FreemiusStageView,
    FreemiusStagingDetailView,
    OrderCreateView,
    OrderDetailView,
    OrderEntitlementsView,
    OrderPayView,
)
from .webhook_views import FastSpringWebhookView, FreemiusWebhookView, PaddleWebhookView

app_name = "commerce"

urlpatterns = [
    path("orders/", OrderCreateView.as_view(), name="order-create"),
    # ORDER MATTERS HERE. Django tries patterns top-to-bottom and Django's
    # `<str:...>` converter matches ANY non-slash segment — including the
    # literal word "pay" or "entitlements". If the token route below came
    # before these two, a request to `/orders/<id>/pay/` would be swallowed
    # by it (matching "pay" as if it were a token) and never reach
    # OrderPayView at all. Both literal routes have to come first.
    #
    # Deliberately NO token variant on `pay/`: paying is a live-checkout
    # action, never something an emailed link to an existing order should
    # be able to trigger, so it always requires a real session.
    path("orders/<uuid:order_id>/pay/", OrderPayView.as_view(), name="order-pay"),
    path("orders/<uuid:order_id>/entitlements/", OrderEntitlementsView.as_view(), name="order-entitlements"),
    path(
        "orders/<uuid:order_id>/entitlements/<str:token>/",
        OrderEntitlementsView.as_view(),
        name="order-entitlements-token",
    ),
    path("orders/<uuid:order_id>/", OrderDetailView.as_view(), name="order-detail"),
    # §12 — the magic-link variant, path-based rather than `?token=`; see
    # `withToken` in the frontend's lib/api/client.ts. A second route, not
    # an optional segment, for the same reason given in delivery/urls.py.
    # Last, because it is the most generic pattern in this file.
    path("orders/<uuid:order_id>/<str:token>/", OrderDetailView.as_view(), name="order-detail-token"),
    # Public — no guest session, no CSRF; see webhook_views.py.
    path("webhooks/paddle/", PaddleWebhookView.as_view(), name="paddle-webhook"),
    # Distinct literal segment from "paddle" above — none of the
    # <str:token>-swallows-a-literal-segment ordering trap the other routes
    # in this file guard against applies here.
    path("webhooks/fastspring/", FastSpringWebhookView.as_view(), name="fastspring-webhook"),
    path("webhooks/freemius/", FreemiusWebhookView.as_view(), name="freemius-webhook"),
    # Freemius (sandbox review build) — deliberately its own literal
    # prefix, not nested under "orders/", since no Order exists until one
    # of these completes. See services.py's module comment for why.
    path("checkout/freemius/stage/", FreemiusStageView.as_view(), name="freemius-stage"),
    path(
        "checkout/freemius/stage/<uuid:staging_id>/",
        FreemiusStagingDetailView.as_view(),
        name="freemius-stage-detail",
    ),
    path("checkout/freemius/complete/", FreemiusCompleteView.as_view(), name="freemius-complete"),
]
