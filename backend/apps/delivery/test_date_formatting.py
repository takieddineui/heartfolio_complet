"""
Regression coverage for the Windows `strftime("%-d")` portability bug
(see `date_formatting.py`'s module docstring for the root cause).

The bug specifically only manifests on Windows, and specifically only
for single-digit days (`%-d` vs `%d` are visually identical for days
10-31) — so a real regression test has to (a) actually check for the
absence of a leading zero, not just that *some* string comes back, and
(b) exercise single-digit days deliberately, since a get-well-soon test
using e.g. "2019-04-12" would pass even with the broken code on Linux
and give false confidence.
"""

from datetime import date

from django.test import SimpleTestCase, TestCase

from .date_formatting import format_month_day_year


class FormatMonthDayYearTests(TestCase):
    def test_single_digit_day_has_no_leading_zero(self):
        # This is the exact case that raised ValueError on Windows
        # with the old `strftime("%b %-d, %Y")` — and the case a
        # naive `%d`-based "fix" would silently zero-pad instead of
        # actually preserving the intended design.
        self.assertEqual(
            format_month_day_year(date(2019, 4, 9), month_format="%b"), "Apr 9, 2019"
        )
        self.assertEqual(
            format_month_day_year(date(2019, 4, 9), month_format="%B"), "April 9, 2019"
        )

    def test_double_digit_day_unaffected(self):
        self.assertEqual(
            format_month_day_year(date(2019, 4, 12), month_format="%b"), "Apr 12, 2019"
        )
        self.assertEqual(
            format_month_day_year(date(2019, 4, 12), month_format="%B"), "April 12, 2019"
        )

    def test_every_single_digit_day_in_a_month(self):
        for day in range(1, 10):
            result = format_month_day_year(date(2020, 1, day), month_format="%b")
            self.assertEqual(result, f"Jan {day}, 2020")

    def test_short_vs_long_month_directive(self):
        self.assertEqual(
            format_month_day_year(date(2019, 12, 25), month_format="%b"), "Dec 25, 2019"
        )
        self.assertEqual(
            format_month_day_year(date(2019, 12, 25), month_format="%B"), "December 25, 2019"
        )

    def test_does_not_use_any_platform_specific_strftime_directive(self):
        """Structural guard against the bug being silently reintroduced:
        no `%-`/`%#`-style flags anywhere in the *executable* source of
        `format_month_day_year` (checking the function body specifically,
        not the whole module — the module docstring above legitimately
        mentions `%-d`/`%#d` as prose describing the bug it avoids).
        """
        import inspect

        from .date_formatting import format_month_day_year as target

        source = inspect.getsource(target)
        self.assertNotIn("%-", source)
        self.assertNotIn("%#", source)


class LocaleFormatCasesTests(SimpleTestCase):
    """The print writes dates and counts in the ORDER's language, exactly as
    the Studio preview does (26 Oct 2026: Love Story Timeline printed "Apr 12,
    2019" on French and Arabic orders). `locale_format_cases.json` holds what
    the browser produces; the frontend's `locale-format-parity.test.ts` checks
    the browser side against the same file."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import json
        from pathlib import Path

        cls.cases = json.loads((Path(__file__).parent / "locale_format_cases.json").read_text(encoding="utf-8"))

    def test_short_dates_match_the_browser_in_every_language(self):
        from apps.delivery.date_formatting import format_short_date

        for case in self.cases["shortDates"]:
            for locale in ("en", "fr", "ar"):
                with self.subTest(iso=case["iso"], locale=locale):
                    self.assertEqual(format_short_date(date.fromisoformat(case["iso"]), locale), case[locale])

    def test_counts_match_the_browser_in_every_language(self):
        from apps.delivery.date_formatting import format_count

        for case in self.cases["counts"]:
            for locale in ("en", "fr", "ar"):
                with self.subTest(n=case["n"], locale=locale):
                    self.assertEqual(format_count(case["n"], locale), case[locale])

    def test_an_unknown_language_is_english(self):
        from apps.delivery.date_formatting import format_count, format_short_date

        self.assertEqual(format_short_date(date(2019, 4, 12), "de"), "Apr 12, 2019")
        self.assertEqual(format_short_date(date(2019, 4, 12), "fr-CA"), "12 avr. 2019")
        self.assertEqual(format_count(1799, None), "1,799")
