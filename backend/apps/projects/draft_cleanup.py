"""Unbought drafts, deleted after 12 months without activity (the privacy
policy's promise, owner's decision 25 Oct 2026).

A draft qualifies only if ALL of these hold:
- its status is `draft`;
- it has not been saved for `months` months (`updated_at`);
- no Order points at it, paid or not;
- no Freemius checkout is open for it, or completed from it.

Its uploads go with it, but only uploads that:
- the draft's data references (`assetId` anywhere in it);
- belong to the draft's own customer;
- no other project still references (a project that is kept, or a paid
  order's).

Uploads no project references at all are counted, never touched: they are
not a draft's, and deciding about them is a separate question.

Every reference to an upload lives in project JSON as `assetId`; no table
holds a foreign key to `Asset` (checked 25 Oct 2026).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from django.utils import timezone

from apps.assets.models import Asset
from apps.commerce.models import FreemiusCheckoutStaging, Order

from .models import Project

#: The privacy policy says 12 months; a shorter window would break it.
MINIMUM_MONTHS = 12


@dataclass
class DraftPlan:
    project: Project
    assets: list[Asset] = field(default_factory=list)


def referenced_asset_ids(data) -> set[str]:
    """Every `assetId` string anywhere in a project's data."""
    found: set[str] = set()
    stack = [data]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "assetId" and isinstance(child, str):
                    found.add(child)
                else:
                    stack.append(child)
        elif isinstance(value, list):
            stack.extend(value)
    return found


def _valid_uuids(values) -> set[str]:
    valid = set()
    for value in values:
        try:
            valid.add(str(uuid.UUID(str(value))))
        except ValueError:
            continue
    return valid


def cutoff_for(months: int, now=None):
    now = now or timezone.now()
    return now - timedelta(days=round(months * 365 / 12))


def inactive_drafts(months: int, now=None):
    """The drafts that qualify (see the module docstring), oldest first."""
    linked_to_orders = Order.objects.filter(project__isnull=False).values("project_id")
    open_or_paid_checkouts = FreemiusCheckoutStaging.objects.filter(
        project__isnull=False,
        status__in=[FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT, FreemiusCheckoutStaging.STATUS_COMPLETED],
    ).values("project_id")
    return (
        Project.objects.filter(status=Project.STATUS_DRAFT, updated_at__lt=cutoff_for(months, now))
        .exclude(id__in=linked_to_orders)
        .exclude(id__in=open_or_paid_checkouts)
        .order_by("updated_at")
    )


def build_plan(months: int, now=None) -> tuple[list[DraftPlan], int]:
    """The drafts to delete with their deletable uploads, and the number of
    uploads no project references at all (reported, never deleted)."""
    drafts = list(inactive_drafts(months, now))
    draft_ids = {draft.id for draft in drafts}

    kept_refs: set[str] = set()
    every_ref: set[str] = set()
    for project_id, data in Project.objects.values_list("id", "data"):
        refs = referenced_asset_ids(data)
        every_ref |= refs
        if project_id not in draft_ids:
            kept_refs |= refs

    plans = []
    claimed: set = set()
    for draft in drafts:
        candidate_ids = _valid_uuids(referenced_asset_ids(draft.data) - kept_refs)
        assets = [
            asset
            for asset in Asset.objects.filter(id__in=candidate_ids, customer_id=draft.customer_id)
            .exclude(status=Asset.STATUS_DELETED)
            .order_by("created_at")
            if asset.id not in claimed
        ]
        claimed.update(asset.id for asset in assets)
        plans.append(DraftPlan(project=draft, assets=assets))

    unreferenced = (
        Asset.objects.exclude(status=Asset.STATUS_DELETED).exclude(id__in=_valid_uuids(every_ref)).count()
    )
    return plans, unreferenced


def still_qualifies(project_id, months: int) -> bool:
    return inactive_drafts(months).filter(id=project_id).exists()
