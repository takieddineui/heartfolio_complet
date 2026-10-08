from django.urls import path

from .ar_views import ARExperienceView
from .live_views import LiveExperienceView
from .target_views import ARTargetUploadView
from .views import (
    EntitlementDownloadView,
    OrderBonusesDownloadView,
    OrderLiveCardsDownloadView,
    OrderPackDownloadView,
    OrderPrintableDownloadView,
    OrderQrCardView,
    OrderRecipientQrCardView,
    OrderWallpaperDownloadView,
)

app_name = "delivery"

urlpatterns = [
    path("entitlements/<uuid:entitlement_id>/download/", EntitlementDownloadView.as_view(), name="entitlement-download"),
    # §12 — the magic-link variant. A second route rather than one
    # "optional" segment, because Django's path converters don't support
    # an optional trailing segment natively — two patterns pointing at the
    # same view, distinguished by whether `token` is present in kwargs, is
    # the straightforward way to express "session OR token, never both."
    # Previously this same choice was expressed as `?token=` on the one
    # route above; moved to the path for the reason given where `withToken`
    # is defined (frontend `lib/api/client.ts`) — briefly, a CDN or proxy
    # caching by path alone, ignoring the query string, would otherwise
    # serve one customer's cached response to anyone who requested the
    # same order id with a different (or no) token.
    path(
        "entitlements/<uuid:entitlement_id>/download/<str:token>/",
        EntitlementDownloadView.as_view(),
        name="entitlement-download-token",
    ),
    # §14 — category-scoped downloads. MUST COME BEFORE the whole-pack
    # `download/<str:token>/` route below: Django tries urlpatterns
    # top-to-bottom and stops at the first match, and `<str:token>` happily
    # matches a literal segment like "bonuses" or "live-cards" too. These
    # four were originally listed AFTER the whole-pack token route and
    # were being silently swallowed by it — `/download/bonuses/` resolved
    # to `OrderPackDownloadView` with `token="bonuses"`, which then failed
    # signature verification and raised `order_not_found`, a 404 that had
    # nothing to do with the order itself. Same specific-before-generic
    # rule `config/urls.py`'s own comment already states for app-level
    # ordering, just not yet applied within this file. Pre-existing bug,
    # not provider-specific — affects every payment provider's orders
    # equally, only ever reached by a real browser hitting these buttons.
    path(
        "orders/<uuid:order_id>/download/printable/",
        OrderPrintableDownloadView.as_view(),
        name="order-download-printable",
    ),
    path(
        "orders/<uuid:order_id>/download/printable/<str:token>/",
        OrderPrintableDownloadView.as_view(),
        name="order-download-printable-token",
    ),
    path(
        "orders/<uuid:order_id>/download/wallpapers/",
        OrderWallpaperDownloadView.as_view(),
        name="order-download-wallpapers",
    ),
    path(
        "orders/<uuid:order_id>/download/wallpapers/<str:token>/",
        OrderWallpaperDownloadView.as_view(),
        name="order-download-wallpapers-token",
    ),
    path(
        "orders/<uuid:order_id>/download/live-cards/",
        OrderLiveCardsDownloadView.as_view(),
        name="order-download-live-cards",
    ),
    path(
        "orders/<uuid:order_id>/download/live-cards/<str:token>/",
        OrderLiveCardsDownloadView.as_view(),
        name="order-download-live-cards-token",
    ),
    path(
        "orders/<uuid:order_id>/download/bonuses/",
        OrderBonusesDownloadView.as_view(),
        name="order-download-bonuses",
    ),
    path(
        "orders/<uuid:order_id>/download/bonuses/<str:token>/",
        OrderBonusesDownloadView.as_view(),
        name="order-download-bonuses-token",
    ),
    # Whole-pack convenience download. Same authorization, same
    # renderers, same throttle scope as the per-entitlement route above.
    # Listed AFTER the category routes above — see the comment there.
    path("orders/<uuid:order_id>/download/", OrderPackDownloadView.as_view(), name="order-pack-download"),
    path(
        "orders/<uuid:order_id>/download/<str:token>/",
        OrderPackDownloadView.as_view(),
        name="order-pack-download-token",
    ),
    # §18d — the live-page QR card, so the order page and the receipt
    # email have a URL for it instead of it being reachable only by
    # unzipping the pack.
    #
    # ONLY THE DEFAULT DESIGN IS SERVED. The alternates ship in the zip;
    # putting the design in the path would collide with the token segment
    # below, and a route that cannot tell a design name from a credential
    # is a route waiting to be confused.
    path("orders/<uuid:order_id>/qr/", OrderQrCardView.as_view(), name="order-qr"),
    # The RECIPIENT's QR (default design), pointing at the live keepsake
    # instead of the order page. MUST COME BEFORE `qr/<str:token>/` just
    # below: "recipient" is a literal segment at the exact same depth as
    # that route's `<str:token>`, so listing the token route first would
    # swallow it exactly the way the §14 download routes were swallowed
    # before that was fixed — see this file's own comment on that bug,
    # a few lines above.
    path(
        "orders/<uuid:order_id>/qr/recipient/",
        OrderRecipientQrCardView.as_view(),
        name="order-qr-recipient",
    ),
    path(
        "orders/<uuid:order_id>/qr/recipient/<str:token>/",
        OrderRecipientQrCardView.as_view(),
        name="order-qr-recipient-token",
    ),
    path(
        "orders/<uuid:order_id>/qr/<str:token>/",
        OrderQrCardView.as_view(),
        name="order-qr-token",
    ),
    # §21f — public by design and the only endpoint here without a
    # session check. There is deliberately no list route beside it.
    path("ar/<str:ar_id>/", ARExperienceView.as_view(), name="ar-experience"),
    # §10 — same security model, different kind. No list route here
    # either, for the same reason.
    path("live/<str:experience_id>/", LiveExperienceView.as_view(), name="live-experience"),
    # §21i — the only AR endpoint that accepts data. Session-gated on
    # the same ownership chain as a download; the AR id is a read
    # credential and is deliberately not accepted here.
    path("ar-targets/<str:entitlement_id>/", ARTargetUploadView.as_view(), name="ar-target-upload"),
]
