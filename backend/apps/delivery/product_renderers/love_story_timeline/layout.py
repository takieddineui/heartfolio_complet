"""
Format-agnostic computation, shared by `png_renderer.py` and
`html_renderer.py` so both outputs derive from the exact same logic —
faithfully mirroring the real frontend component's behavior
(src/lib/studio/product-modules/love-story-timeline/renderer.tsx):
event sorting and the "N days together" duration line. (The
premium-module display line this comment used to mention was removed
along with the feature itself — Premium add-on never shipped as part
of the real product and left only dead logic behind.)

Kept separate from both renderers specifically so a future Live
Preview feature could reuse it too (see the `preview()` slot on
`ProductRenderer` in apps/delivery/renderers.py) — this module has no
knowledge of PNG or HTML at all.
"""

from __future__ import annotations

from datetime import date as date_cls

from apps.delivery.date_formatting import format_short_date

from .data import NormalizedTimeline, TimelineEvent


def ordered_events(timeline: NormalizedTimeline) -> list[TimelineEvent]:
    """Mirrors renderer.tsx: `values.autoSort ? [...events].sort(...) : events`."""
    if timeline.auto_sort:
        return sorted(timeline.events, key=lambda event: event.date)
    return list(timeline.events)


def days_together(events: list[TimelineEvent], *, show_duration: bool) -> int | None:
    """Mirrors renderer.tsx's `duration` computation exactly, including
    using the *first and last* of the (possibly already-sorted) events
    array — not necessarily the earliest/latest dates, if `autoSort` is
    off and the events are stored out of order.
    """
    if not show_duration or len(events) < 2:
        return None
    try:
        start = date_cls.fromisoformat(events[0].date)
        end = date_cls.fromisoformat(events[-1].date)
    except ValueError:
        return None
    return max(0, (end - start).days)




def format_event_date(iso_date: str, locale: str = "en") -> str:
    """The milestone date as the Studio preview's `formatDate()` writes it
    (`{month: "short", day: "numeric", year: "numeric"}`) in the ORDER's
    language: "Apr 12, 2019", "12 avr. 2019", "12 أبريل 2019". It was
    English for every order until 26 Oct 2026.
    """
    try:
        d = date_cls.fromisoformat(iso_date)
    except ValueError:
        return ""
    return format_short_date(d, locale)
