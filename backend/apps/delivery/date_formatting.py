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
