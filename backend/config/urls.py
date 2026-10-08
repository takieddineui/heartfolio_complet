"""
Root URL configuration.

- `/admin/` - standard Django admin, no business models registered yet.
- `/api/v1/` - the versioned API root, assembled from each app's own
  `urls.py`:
  - `apps.common.urls` - health check.
  - `apps.customers.urls` - guest identity (`/api/v1/guest/`).
  - `apps.products.urls` - public product/delivery-pack catalog.
  - `apps.projects.urls` - project persistence (session-owned).
  - `apps.delivery.urls` - entitled delivery downloads (session-owned).
  - `apps.commerce.urls` - orders, payment, entitlements (session-owned).
  - `apps.assets.urls` - input asset upload/retrieval/delete (session-owned).

ORDER MATTERS, same reason it does within a single app's own urlpatterns
(see commerce/urls.py's own comment on this): Django tries every included
app's patterns top-to-bottom across the WHOLE list, not just within one
app. `apps.delivery.urls` registers `orders/<uuid:order_id>/download/`
and its token variant; `apps.commerce.urls` registers a generic
`orders/<uuid:order_id>/<str:token>/` as its own last, most-general
pattern. If commerce were tried first, that generic pattern would match
`orders/<uuid>/download/` too — treating "download" as if it were a
token — and delivery's own download route would never be reached.
`apps.delivery.urls` has to come first: its routes are more specific
(they require the literal "download" segment), so trying them first
resolves the correct request there and leaves commerce's own routes,
including its generic token pattern, to correctly catch everything else.
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("apps.common.urls")),
    path("api/v1/", include("apps.customers.urls")),
    path("api/v1/", include("apps.products.urls")),
    path("api/v1/", include("apps.projects.urls")),
    path("api/v1/", include("apps.delivery.urls")),
    path("api/v1/", include("apps.commerce.urls")),
    path("api/v1/", include("apps.assets.urls")),
    path("api/v1/", include("apps.feedback.urls")),
]
