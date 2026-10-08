from django.urls import path

from .views import (
    health_check,
    ops_index_page,
    ops_lookup_page,
    ops_reconcile_page,
    ops_reports_page,
    ops_resend_page,
    ops_status_json,
    ops_status_page,
    readiness_check,
    YouTubeValidateView,
)

app_name = "common"

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("health/ready/", readiness_check, name="readiness-check"),
    # Song Poster’s YouTube link check — public, not under /ops/, since
    # a guest composing in the Studio calls this directly.
    path("youtube/validate/", YouTubeValidateView.as_view(), name="youtube-validate"),
    # §7b/§9 — staff-only ops surfaces, not part of the public API.
    # The index is the one URL worth remembering; the rest keep their own
    # addresses so each screen stays bookmarkable and keeps its own POST
    # target.
    path("ops/", ops_index_page, name="ops-index"),
    path("ops/status/", ops_status_page, name="ops-status"),
    path("ops/status.json", ops_status_json, name="ops-status-json"),
    path("ops/reports/", ops_reports_page, name="ops-reports"),
    path("ops/lookup/", ops_lookup_page, name="ops-lookup"),
    path("ops/reconcile/", ops_reconcile_page, name="ops-reconcile"),
    path("ops/resend/", ops_resend_page, name="ops-resend"),
]
