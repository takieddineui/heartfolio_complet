from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from django.contrib.admin.views.decorators import staff_member_required
from django.db import connection
from django.db.utils import OperationalError
from django.shortcuts import render
from django.utils import timezone

from apps.commerce.analytics import PERIODS, build_report
from django.db.models import Q

from apps.commerce.lookup import lookup_orders
from apps.commerce.emails import send_order_confirmation
from apps.commerce.models import Order
from django.core.exceptions import ValidationError
from apps.feedback.models import Feedback
from apps.commerce.paddle_read import PaddleUnavailable, find_transactions_for_order
from apps.commerce.reconcile import ReconcileRefused, reconcile_order_from_paddle

from .service_health import overall_status, run_all_checks


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    """Confirms the Django application is running and able to handle a
    request. Deliberately does not touch the database, storage, or any
    external service — this is process liveness, not a dependency check.
    """
    return Response({"status": "ok"})


@api_view(["GET"])
@permission_classes([AllowAny])
def readiness_check(request):
    """Confirms the application can actually serve real traffic, not
    just that the process is up — currently just database connectivity
    (the one dependency every request in this app needs). Intentionally
    does *not* probe R2 or Paddle on every request: both already fail
    loudly at process startup if misconfigured in production (see
    `config/settings/production.py`), so a live per-request network
    round-trip to either here would only add latency/cost to every
    orchestrator health-check poll without catching anything the
    startup-time check doesn't already catch.
    """
    try:
        connection.ensure_connection()
    except OperationalError:
        return Response({"status": "unavailable", "database": "unreachable"}, status=503)
    return Response({"status": "ok", "database": "reachable"})


@staff_member_required
def ops_status_page(request):
    """The phone-first "is everything OK" page (§7b, §9).

    STAFF ONLY. `staff_member_required` redirects an anonymous visitor to the
    Django admin login, which is §9's "same login throughout" — no second
    credential to hold, and no new auth surface to get wrong. The page also
    carries `noindex, nofollow`, though `robots.txt` should exclude this path
    too if it is ever served from a crawlable host.

    Never cached. A status page showing a cached green while a service is
    down is worse than having none, because it is consulted precisely when
    the reader needs to trust it.
    """
    results = run_all_checks()
    return render(
        request,
        "ops/status.html",
        {
            "services": results,
            "overall": overall_status(results),
            "checked_at": timezone.localtime().strftime("%d %b %Y, %H:%M:%S %Z"),
        },
    )


@api_view(["GET"])
@permission_classes([IsAdminUser])
def ops_status_json(request):
    """The same checks as JSON.

    Exists for §9's Telegram alerting, which needs to ask "is anything down"
    on a schedule without scraping HTML. Building the alerting itself needs a
    bot token and a chat ID, so it is not built here — but the thing it will
    poll is, and shipping the page without it would guarantee this logic gets
    duplicated later.
    """
    results = run_all_checks()
    return Response(
        {
            "overall": overall_status(results),
            "services": [
                {
                    "key": r.key,
                    "label": r.label,
                    "status": r.status,
                    "detail": r.detail,
                    "latencyMs": r.latency_ms,
                }
                for r in results
            ],
        }
    )


class YouTubeValidateView(APIView):
    """`POST /api/v1/youtube/validate/` `{"url": "..."}` — Song Poster's
    gate on the YouTube link before checkout.

    CLASS-BASED, MATCHING `AssetUploadView`'S PATTERN, deliberately —
    not the `@api_view` function style the rest of this file uses for
    its GET endpoints. Those never set a `throttle_scope`, and DRF's
    scoped throttle for a bare function view needs the scope attribute
    set on the wrapped function object after the fact, which is a subtler
    pattern than it looks and easy to get silently wrong — the failure
    mode is "no throttling happens" rather than an error. `throttle_scope`
    as a plain class attribute on an `APIView` is the same one-line
    mechanism already proven working on every delivery/asset endpoint in
    this codebase, so it is what is used here too.

    PUBLIC, NOT SESSION-GATED, on purpose: this runs while a guest is
    still composing in the Studio, often before `POST /guest/` has ever
    been called for them — the same reasoning `health_check` is public.
    It reveals nothing about any customer or order; the only thing it
    can leak is whether a given YouTube video exists, which is public
    information already.

    Response shape mirrors every other API response's camelCase
    convention (`ops_status_json` above, the delivery/commerce APIs):
      200 {"valid": true, "videoId", "title", "authorName", "thumbnailUrl"}
      200 {"valid": false, "reason": "..."}   — NOT a 4xx. A customer
        pasting the wrong link is an expected, everyday outcome the
        Studio needs to show inline, not an error condition — the same
        distinction `checkout-flow.tsx` already draws between a 4xx
        (shown as-is) and a genuine failure.
    """

    permission_classes = [AllowAny]
    throttle_scope = "youtube_validate"

    def post(self, request):
        from apps.common.youtube import YouTubeValidationError, check_embeddable, extract_video_id

        # `code` is what the Studio shows, translated; `reason` is English
        # and only for logs and debugging.
        raw = request.data.get("url")
        url = raw.strip() if isinstance(raw, str) else ""
        if not url:
            return Response({"valid": False, "code": "empty", "reason": "Paste a YouTube link."})

        video_id = extract_video_id(url)
        if not video_id:
            return Response({"valid": False, "code": "notYoutube", "reason": "That doesn't look like a YouTube link."})

        try:
            info = check_embeddable(video_id)
        except YouTubeValidationError as exc:
            return Response({"valid": False, "code": exc.code, "reason": str(exc)})

        return Response(
            {
                "valid": True,
                "videoId": video_id,
                "title": info["title"],
                "authorName": info["author_name"],
                "thumbnailUrl": info["thumbnail_url"],
            }
        )


@staff_member_required
def _feedback_rows(queryset):
    """Shapes Feedback rows for the ops template.

    The message is NOT truncated here. Staff reading feedback need the
    whole thing — a clipped complaint is the one case where the missing
    half is the part that mattered.
    """
    return [
        {
            "created_at": item.created_at,
            "rating": item.rating,
            "message": (item.message or "").strip(),
            "product": item.product.slug if item.product_id else "—",
            "order_id": str(item.order_id) if item.order_id else "",
            "display_name": item.display_name,
            "is_published": item.is_published,
        }
        for item in queryset
    ]


def ops_reports_page(request):
    """Sales reports (§7a).

    Desktop-oriented per §9, behind the same admin login as the status page
    — one credential, one auth surface.

    Money is formatted here rather than in the template. `total_cents` is an
    integer of minor units, and dividing it in a template filter is how a
    revenue figure quietly becomes wrong by a factor of a hundred.
    """
    period = request.GET.get("period", "monthly")
    report = build_report(period)

    def money(cents):
        return f"{cents / 100:,.2f}"

    trend = [
        {"period": point.period, "orders": point.orders, "revenue_cents": money(point.revenue_cents)}
        for point in report["trend"]
    ]

    def rows(items):
        return [
            {"label": row.label, "orders": row.orders, "revenue_cents": money(row.revenue_cents)}
            for row in items
        ]

    return render(
        request,
        "ops/reports.html",
        {
            "period": report["period"],
            "period_options": list(PERIODS.keys()),
            "trend": trend,
            "average_order_value": money(report["average_order_value_cents"]),
            "customers": report["customers"],
            "payments": report["payments"],
            "breakdowns": [
                {"title": "By category", "column": "Category", "rows": rows(report["by_category"])},
                {"title": "By product", "column": "Product", "rows": rows(report["by_product"])},
                {"title": "By pack", "column": "Product / pack", "rows": rows(report["by_pack"])},
                {
                    "title": "By buyer country",
                    "column": "Country",
                    "rows": rows(report["by_country"]),
                    "note": (
                        "From Paddle's own transaction record — Heartfolio never asks for a "
                        "country. Paddle does not send an address on every webhook, so "
                        "'Unknown' is shown rather than dropping those orders."
                    ),
                },
            ],
            # §7c — feedback, in two sections, because they answer
            # different questions. "Needs review" is a worklist: unpublished
            # submissions, oldest problem first, since publishing is a
            # deliberate staff action taken in /admin/. "Recent" is a pulse
            # check: everything, newest first, published or not.
            #
            # Capped at 50 each. This page has no pagination and never has;
            # an unbounded query here would eventually make the whole
            # reports screen slow to load for everyone.
            "feedback_unreviewed": _feedback_rows(
                Feedback.objects.filter(is_published=False).select_related("product", "order").order_by("created_at")[:50]
            ),
            "feedback_recent": _feedback_rows(
                Feedback.objects.select_related("product", "order").order_by("-created_at")[:50]
            ),
        },
    )


@staff_member_required
def ops_lookup_page(request):
    """Phone-first order lookup (§9).

    Same admin login as the other ops pages. Read-only by design: this
    answers "what happened to this order", and any action taken as a result
    belongs on a screen that says what it is about to do.
    """
    query = request.GET.get("q", "")
    return render(
        request,
        "ops/lookup.html",
        {"query": query, "results": lookup_orders(query) if query else []},
    )


@staff_member_required
def ops_reconcile_page(request):
    """Verify & Reconcile (§8, §9's third phone-first screen).

    Staff search by what they actually have — a customer's email or an order
    id — rather than needing the raw Paddle transaction id up front, which
    is §8's confirmed UX refinement.

    POST performs the reconciliation. It is a POST rather than a link
    because it changes money-adjacent state, and Django's CSRF protection
    applies to the form.
    """
    query = request.GET.get("q", "") or request.POST.get("q", "")
    message = error = None
    order = None
    candidates = []

    if request.method == "POST":
        try:
            target = Order.objects.get(id=request.POST.get("order_id"))
            message = reconcile_order_from_paddle(target, request.POST.get("transaction_id", ""))
            query = str(target.id)
        except Order.DoesNotExist:
            error = "That order no longer exists."
        except ReconcileRefused as exc:
            # Shown verbatim: these messages are the reason to trust this
            # screen. "Verification failed" would tell staff nothing about
            # whether to escalate or to look at a different transaction.
            error = str(exc)

    if query:
        order = _find_order(query)
        if order is None:
            error = error or "No order matched that."
        elif order.status != Order.STATUS_PAID:
            try:
                candidates = find_transactions_for_order(order)
            except PaddleUnavailable as exc:
                # Never reported as "no transactions found" — an outage read
                # as absence would lead staff to the opposite conclusion.
                error = error or f"Could not reach Paddle: {exc}"

    return render(
        request,
        "ops/reconcile.html",
        {
            "query": query,
            "order": order,
            "order_total": f"{order.total_cents / 100:,.2f}" if order else "",
            "candidates": candidates,
            "message": message,
            "error": error,
        },
    )


@staff_member_required
def ops_index_page(request):
    """The ops front door (§9).

    `/api/v1/ops/` returned 404, so the five staff screens had five URLs to
    remember and no relationship between them. This is one address that
    leads to all of them.

    A page rather than a redirect to Reports: a redirect would make the
    slowest screen — it runs revenue aggregates over every order — the cost
    of simply reaching the tools, including when the thing you actually
    need is a 2-second order lookup.
    """
    return render(request, "ops/index.html", {})


@staff_member_required
def ops_resend_page(request):
    """Re-send a paid order's magic link (§9).

    WHY THIS IS ITS OWN SCREEN. The lookup page is read-only on purpose —
    its docstring says any action belongs on a screen that states what it
    is about to do. Re-sending an email to a customer is exactly that kind
    of action, so it follows the Reconcile pattern: search by what staff
    actually have, then an explicit POST.

    WHY IT EXISTS AT ALL. The magic link in the receipt expires after 30
    days, while the purchase itself does not: photos are permanent from
    upload and artwork is rendered on demand, so a paid order stays
    deliverable indefinitely. Without this, a customer who lost the email
    had files that existed and no way to reach them — and the alternative,
    building accounts, is explicitly ruled out in `site-config.ts`.

    `send_order_confirmation` builds a fresh token every call, so the link
    is new and the old one is irrelevant.
    """
    query = request.GET.get("q", "") or request.POST.get("q", "")
    message = error = None
    order = None

    if request.method == "POST":
        try:
            target = Order.objects.get(id=request.POST.get("order_id"))
        except (Order.DoesNotExist, ValueError, ValidationError):
            target = None

        if target is None:
            error = "That order no longer exists."
        elif target.status != Order.STATUS_PAID:
            # Sending a "your keepsake is ready" email for an unpaid order
            # would hand over a working link to something not bought.
            error = "That order is not paid — nothing to re-send."
        elif send_order_confirmation(target):
            message = f"Sent to {target.guest_email}."
            query = str(target.id)
        else:
            # `send_order_confirmation` never raises and returns False when
            # Resend refuses or is unconfigured. Reported rather than
            # swallowed: staff have just told a customer it is on its way.
            error = "The email provider did not accept it — check the logs."
            query = str(target.id)

    if query and order is None:
        order = _find_order(query)
        if order is None:
            error = error or "No order matched that."

    return render(
        request,
        "ops/resend.html",
        {
            "query": query,
            "order": order,
            "order_total": f"{order.total_cents / 100:,.2f}" if order else "",
            "message": message,
            "error": error,
        },
    )


def _find_order(query: str):
    """Resolves an order from an email or an id, preferring an unpaid one.

    A customer who has bought twice has two orders on one email; the one
    being asked about is almost always the one that did not complete, which
    is why unpaid sorts first rather than newest-first.
    """
    query = query.strip()
    orders = Order.objects.filter(
        Q(guest_email__iexact=query) | Q(id__startswith=query) if len(query) >= 4
        else Q(guest_email__iexact=query)
    ).order_by("status", "-created_at")
    return orders.first()
