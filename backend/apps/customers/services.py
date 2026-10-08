"""
Guest identity service functions.

Kept deliberately small: two operations, no repository/factory
abstractions. This is the only place `Customer` is created or looked up
from outside the `customers` app — views call into this module rather
than touching `Customer.objects` directly, so the "how a guest becomes a
customer" rule lives in exactly one place.
"""

from __future__ import annotations

import uuid

from apps.common.exceptions.api_errors import CustomerIdentityRequired

from .models import Customer

SESSION_CUSTOMER_ID_KEY = "customer_id"


def get_or_create_guest_customer(email: str) -> tuple[Customer, bool]:
    """Resolves a `Customer` for the given email, creating one if it
    doesn't exist yet. Matching is case-insensitive because `email` is a
    CITEXT column — `Customer.objects.get_or_create(email=email)` already
    compares case-insensitively at the database level, so no manual
    `.lower()`/`iexact` normalization is needed here. Only surrounding
    whitespace is stripped before the lookup.
    """
    normalized_email = email.strip()
    customer, created = Customer.objects.get_or_create(email=normalized_email)
    return customer, created


def get_customer_by_id(customer_id: str) -> Customer | None:
    """Looks up a customer by id, returning `None` for anything that
    isn't a valid, existing customer — including a malformed UUID string
    (e.g. a tampered or stale session value), rather than letting a
    `ValueError` propagate out of a session-resolution code path.
    """
    try:
        parsed_id = uuid.UUID(str(customer_id))
    except (ValueError, TypeError, AttributeError):
        return None

    return Customer.objects.filter(id=parsed_id).first()


def get_current_customer(request) -> Customer:
    """Resolves the guest `Customer` for the current session, or raises
    `CustomerIdentityRequired` (401) if there is no session identity yet
    or it no longer points at a real customer. Used by every endpoint
    (outside `apps/customers` itself) that requires a guest identity —
    `projects` and `commerce` views call this rather than reading
    `request.session` directly, so "how a request's customer is
    resolved" stays defined in exactly one place.
    """
    customer_id = request.session.get(SESSION_CUSTOMER_ID_KEY)
    if not customer_id:
        raise CustomerIdentityRequired()

    customer = get_customer_by_id(customer_id)
    if customer is None:
        # Stale/invalid reference — drop it rather than keep failing
        # the same way on every subsequent request.
        del request.session[SESSION_CUSTOMER_ID_KEY]
        raise CustomerIdentityRequired()

    return customer
