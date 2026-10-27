/**
 * The live page's "how long" line: years, months and days between the first
 * and last milestone (§10: "4 years, 2 months" is meaningful; minutes are a
 * novelty).
 *
 * It used to print "3y 4m 22d" on every page, French and Arabic included, and
 * computed with local-time getters on dates parsed as UTC midnight, the same
 * west-of-UTC trap as `formatDate`. Now the arithmetic is in UTC and the words
 * come from the browser's own unit names, so plurals (Arabic duals: "شهران")
 * and the list's "and" are the locale's.
 */

export type Duration = { years: number; months: number; days: number };

/** Calendar difference between the earliest and latest dates, or null. */
export function milestoneDuration(dates: readonly (string | undefined | null)[]): Duration | null {
  const sorted = dates.filter((d): d is string => Boolean(d)).sort();
  if (sorted.length < 2) return null;
  const from = new Date(sorted[0]!);
  const to = new Date(sorted[sorted.length - 1]!);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return null;

  // Whole months from `from` (a 31st that a month lacks lands on its last
  // day, as calendars count), then the days left over. The old "borrow the
  // previous month's length" rule went negative at month ends (Jan 31 to
  // Mar 1 was "1 month, -1 days").
  let total = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (addMonths(from, total) > to) total -= 1;
  if (total < 0) return null;
  const years = Math.floor(total / 12);
  const months = total % 12;
  const days = Math.round((to.valueOf() - addMonths(from, total).valueOf()) / 86_400_000);
  return { years, months, days };
}

/** "3 years, 4 months, and 22 days" / "3 ans, 4 mois et 22 jours" /
 *  "3 سنوات و4 أشهر و22 يومًا". Zero parts are left out; "" if all are zero. */
export function formatDuration(duration: Duration, locale: string): string {
  const parts = (
    [
      [duration.years, "year"],
      [duration.months, "month"],
      [duration.days, "day"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, unit]) => new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(n));
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(parts);
}

/** `date` plus `months`, its day clamped to the target month's length (UTC). */
function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last)));
}
