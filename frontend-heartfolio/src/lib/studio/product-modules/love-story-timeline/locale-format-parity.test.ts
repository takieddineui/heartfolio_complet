import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCount, formatDate } from "./renderer";

/**
 * PREVIEW AND PRINT WRITE DATES AND COUNTS THE SAME WAY, IN THE ORDER'S
 * LANGUAGE (26 Oct 2026). The print wrote "Apr 12, 2019" on French and Arabic
 * orders while the preview showed "12 avr. 2019" / "12 أبريل 2019".
 * `backend/apps/delivery/locale_format_cases.json` holds the expected strings;
 * the backend's `LocaleFormatCasesTests` checks the print's formatter against
 * the same file. If a browser's `Intl` ever changes them, this fails and the
 * backend table must follow.
 */
const CASES = JSON.parse(
  readFileSync(join(process.cwd(), "..", "backend", "apps", "delivery", "locale_format_cases.json"), "utf8")
) as {
  shortDates: { iso: string; en: string; fr: string; ar: string }[];
  counts: { n: number; en: string; fr: string; ar: string }[];
};
const LOCALES = ["en", "fr", "ar"] as const;

describe("dates and counts, preview vs print", () => {
  it.each(LOCALES)("%s: the preview's milestone dates are the print's", (locale) => {
    for (const c of CASES.shortDates) {
      // The bare day, as the Studio stores it.
      expect(formatDate(c.iso, locale), c.iso).toBe(c[locale]);
    }
  });

  it.each(LOCALES)("%s: the preview's day counts are the print's", (locale) => {
    for (const c of CASES.counts) expect(formatCount(c.n, locale), String(c.n)).toBe(c[locale]);
  });

  /** A milestone is a calendar day; the preview formatted it in the
   *  visitor's own zone, so west of UTC every date showed the day before
   *  (fixed 26 Oct 2026). Node only honours TZ when set from inside. */
  it.each(["America/Los_Angeles", "Pacific/Kiritimati"])("gives the same day in %s", (zone) => {
    const original = process.env.TZ;
    process.env.TZ = zone;
    try {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
      for (const c of CASES.shortDates) expect(formatDate(c.iso, "en"), c.iso).toBe(c.en);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("the cases cover every month and a single-digit day", () => {
    const months = new Set(CASES.shortDates.map((c) => c.iso.slice(5, 7)));
    expect(months.size).toBe(12);
    expect(CASES.shortDates.some((c) => c.iso.endsWith("-05"))).toBe(true);
  });
});
