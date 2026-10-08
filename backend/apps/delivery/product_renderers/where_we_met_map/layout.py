"""
Format-agnostic computation for Where We Met Map, mirroring the real
frontend component (src/lib/studio/product-modules/where-we-met-map/
renderer.tsx) exactly: the equirectangular projection function and the
deterministic decorative-dot scatter use the identical formulas, so
the backend's static map backdrop is generated the same way the
frontend's is — not a different design invented independently.
"""

from __future__ import annotations

from datetime import date as date_cls

from apps.delivery.date_formatting import format_month_day_year


def project(lat: float, lng: float, width: float, height: float) -> tuple[float, float]:
    """Deterministic equirectangular projection — identical to
    renderer.tsx's `project()`. Given the same coordinates, always the
    same pixel position. No map tiles, no external service, no network
    access — see the Phase 3.11 report's "Map rendering strategy" for
    why this matches the real frontend's own approach rather than a
    backend-invented alternative: the frontend's own code comment
    describes this as "an art-directed static illustration... rather
    than literal cartography," which is what this replicates.
    """
    x = ((lng + 180) / 360) * width
    y = ((90 - lat) / 180) * height
    return x, y


def decorative_dot_positions(width: float, height: float, *, count: int = 40) -> list[tuple[float, float]]:
    """Identical pseudo-random formula to `DecorativeMapBackdrop` in
    renderer.tsx — the same seed arithmetic produces the same relative
    dot scatter pattern on both frontend and backend.
    """
    positions = []
    for i in range(count):
        seed = (i * 9301 + 49297) % 233280
        x = (seed / 233280) * width
        y = ((seed * 37) % 233280 / 233280) * height
        positions.append((x, y))
    return positions


def format_date(iso_date: str) -> str:
    """Mirrors `date.toLocaleDateString(locale, {month: "long", day:
    "numeric", year: "numeric"})` for en-US, e.g. "April 12, 2019".
    English/en-US only — see the Phase 3.9/3.11 reports' "Known
    limitations".
    """
    if not iso_date:
        return ""
    try:
        d = date_cls.fromisoformat(iso_date)
    except ValueError:
        return ""
    return format_month_day_year(d, month_format="%B")
