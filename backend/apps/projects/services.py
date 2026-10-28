"""
Project persistence service functions. Ownership (does this project
belong to this customer) is enforced here, once, rather than
independently in every view.
"""

from __future__ import annotations

from apps.assets.filenames import strip_media_filenames
from apps.common.exceptions.api_errors import (
    InvalidProjectData,
    ProjectAccessDenied,
    ProjectNotFound,
)
from apps.products.services import get_product_by_slug

from .models import Project, default_project_data

_REQUIRED_DATA_KEYS = {"version", "values", "themeSelections"}


def validate_project_data(data) -> None:
    """Application-level check for the exact structural contract
    `{"version": <int>, "values": {}, "themeSelections": {}}` — kept
    separate from (and stricter/friendlier than) the database's own
    `jsonb_typeof`/key-existence CHECK constraints, so a bad request
    produces a clean `invalid_project_data` API error instead of a raw
    `IntegrityError` reaching the client. `values` and
    `themeSelections` are validated only for being present and being
    objects — their contents remain opaque, product-module-owned state
    this backend never inspects.
    """
    if not isinstance(data, dict):
        raise InvalidProjectData("Project data must be a JSON object.")
    if set(data.keys()) != _REQUIRED_DATA_KEYS:
        raise InvalidProjectData(
            "Project data must contain exactly the keys: version, values, themeSelections."
        )
    if not isinstance(data["version"], int):
        raise InvalidProjectData("Project data 'version' must be an integer.")
    if not isinstance(data["values"], dict):
        raise InvalidProjectData("Project data 'values' must be an object.")
    if not isinstance(data["themeSelections"], dict):
        raise InvalidProjectData("Project data 'themeSelections' must be an object.")


def _validate_status(value: str) -> None:
    if value not in (Project.STATUS_DRAFT, Project.STATUS_COMPLETED):
        raise InvalidProjectData(f"'{value}' is not a valid project status.")


def create_project(customer, *, product_slug: str, data=None, status: str = Project.STATUS_DRAFT) -> Project:
    product = get_product_by_slug(product_slug)  # raises ProductNotFound

    if data is None:
        data = default_project_data()
    else:
        validate_project_data(data)
        data, _ = strip_media_filenames(data)

    _validate_status(status)

    return Project.objects.create(customer=customer, product=product, data=data, status=status)


def get_project_for_customer(customer, project_id) -> Project:
    """Resolves a project and enforces ownership in one place. Returns
    404 (`project_not_found`) if the row doesn't exist at all, and 403
    (`project_access_denied`) if it exists but belongs to a different
    guest — the API contract defines both as distinct codes, so this
    deliberately doesn't collapse the two into a uniform 404.
    """
    try:
        project = Project.objects.select_related("product").get(id=project_id)
    except (Project.DoesNotExist, ValueError, TypeError):
        raise ProjectNotFound()

    if project.customer_id != customer.id:
        raise ProjectAccessDenied()

    return project


def update_project(customer, project_id, *, data=None, status: str | None = None) -> Project:
    project = get_project_for_customer(customer, project_id)

    if data is not None:
        validate_project_data(data)

        # A paid order's project must not be editable into something its
        # renderer would refuse — otherwise an edit after payment could
        # make an already-delivered (or about-to-be-delivered) keepsake
        # unrenderable, the exact hole `apps.commerce.services.create_order`'s
        # own check closes at order-creation time. This is NOT a flat lock:
        # a second checkout for the SAME project (buying another pack) is a
        # completely ordinary flow, and `checkout-engine.ts`'s `prepareOrder`
        # re-saves the project on every attempt, unconditionally, even when
        # nothing changed — a hard lock on "has a paid order" would break
        # that resave, and with it, buying a second pack. Re-validating
        # instead of refusing outright lets an unchanged (or a still-valid
        # edited) re-save through, and only rejects an edit that would
        # actually break the paid keepsake.
        #
        # No extra check for a project with only a pending/failed order —
        # its checkout is resumable (see `checkout-engine.ts`'s own
        # docstring), and a resumable retry must be able to save an
        # in-progress edit exactly as before.
        #
        # Deferred import: matches this module's existing convention of
        # not importing `apps.commerce` at module scope (`apps.commerce`
        # already imports `apps.projects.models` — see that app's own
        # models.py — so this direction is kept deliberate, not assumed).
        from apps.commerce.models import Order
        from apps.delivery.registry import get_renderer

        if project.orders.filter(status=Order.STATUS_PAID).exists():
            renderer = get_renderer(project.product.slug, "")
            validate_project_renderability = getattr(renderer, "validate_project_data", None)
            if validate_project_renderability is not None:
                validate_project_renderability(
                    data.get("values", {}), data.get("themeSelections", {})
                )

        # No customer filename is kept (see `apps/assets/filenames.py`).
        project.data, _ = strip_media_filenames(data)

    if status is not None:
        _validate_status(status)
        project.status = status

    project.save()
    return project


def delete_project(customer, project_id) -> None:
    project = get_project_for_customer(customer, project_id)
    project.delete()
