"""Whether a seed run may write a price (§5).

Extracted from `seed_catalog.py` so it can be tested without importing that
module, which calls `django.setup()` against production settings at import
time purely to be runnable as a script.

The rule: a price in `seed_catalog.py` is an INITIAL value for a fresh
database, not the source of truth. Once a row exists, its price belongs to
the database — where it is decided and where the storefront and checkout
both read it from. A run that would change it says so and leaves it alone,
unless the operator explicitly asked with `--update-prices`.
"""

from __future__ import annotations


def price_defaults(
    existing,
    field: str,
    value: int,
    update_prices: bool,
    label: str,
    drift: list[str],
) -> dict:
    """Returns the price portion of an `update_or_create` defaults dict.

    Empty when the price must not be touched — which is the point: omitting
    the key from `defaults` is what leaves the stored value alone, rather
    than writing it back unchanged.

    Any unapplied difference is appended to `drift` so the run reports it.
    Silently skipping would trade one invisible behaviour for another.
    """
    if existing is None or update_prices:
        return {field: value}

    current = getattr(existing, field)
    if current != value:
        drift.append(
            f"  {label}: database has ${current / 100:.2f}, "
            f"this file says ${value / 100:.2f}  (left unchanged)"
        )
    return {}
