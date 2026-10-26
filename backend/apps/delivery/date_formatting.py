"""
A single, deliberately tiny helper shared by both product renderers'
`layout.py` modules — not product-specific logic (each renderer's own
`layout.py` remains independently decoupled, per their own module
docstrings), just a portability fix for one thing Python's `strftime`
gets wrong across platforms.

Both Love Story Timeline and Where We Met Map need a date formatted as
"<Month> <day>, <year>" with NO leading zero on the day (e.g. "Apr 9,
2019", not "Apr 09, 2019") — that's a real product-design requirement,
not a formatting nicety, so switching to `%d` (which zero-pads) is not
an acceptable fix.

The obvious-looking `strftime("%-d")` is a GNU/BSD libc extension.
Python's `date.strftime` delegates straight to the C library's
`strftime`, so the set of supported directives is whatever the
platform's C library supports — `%-d` works on Linux/macOS (glibc/
BSD libc) but raises `ValueError: Invalid format string` on Windows
(MSVCRT doesn't implement the GNU no-padding-flag family at all; it
has its own non-portable `%#d` instead). Rather than branching on
`platform.system()` to pick between two different non-standard flags,
this sidesteps `strftime` for the day entirely: `date.day` is a plain
int, and `str(int)` never zero-pads on any platform — that's ordinary
Python, not libc, so it's platform-independent by construction.
"""

from __future__ import annotations

from datetime import date as date_cls


def format_month_day_year(d: date_cls, *, month_format: str) -> str:
    """`month_format` is any portable strftime directive for the month
    (e.g. "%b" for "Apr", "%B" for "April") — only the day is handled
    outside strftime. Year formatting is left to strftime's own "%Y"
    unchanged, so its platform behavior (already portable) isn't
    reinvented here.
    """
    return d.strftime(f"{month_format} ") + str(d.day) + d.strftime(", %Y")


#: The order's language for prints (26 Oct 2026): Love Story Timeline's
#: milestone dates printed "Apr 12, 2019" on every order, in French and
#: Arabic too, while the Studio preview showed "12 avr. 2019" / "12 أبريل
#: 2019". These reproduce the browser's `toLocaleDateString(locale, {month:
#: "short", day: "numeric", year: "numeric"})` and `toLocaleString(locale)`
#: (Arabic keeps Latin digits there, as Chrome does); `locale_format_cases.json`
#: pins both sides to the same strings.
SHORT_MONTHS = {
    "en": ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
    "fr": ("janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."),
    "ar": ("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"),
}


def _language(locale: str | None) -> str:
    language = (locale or "en").split("-")[0].lower()
    return language if language in SHORT_MONTHS else "en"


def format_short_date(d: date_cls, locale: str | None = "en") -> str:
    """"Apr 12, 2019" / "12 avr. 2019" / "12 أبريل 2019"."""
    language = _language(locale)
    month = SHORT_MONTHS[language][d.month - 1]
    if language == "en":
        return f"{month} {d.day}, {d.year}"
    return f"{d.day} {month} {d.year}"


def format_count(n: int, locale: str | None = "en") -> str:
    """"1,799" / "1 799" (French groups with a narrow no-break space) /
    "1,799"."""
    grouped = f"{n:,}"
    return grouped.replace(",", " ") if _language(locale) == "fr" else grouped
