import { afterEach, describe, expect, it } from "vitest";
import { formatDuration, milestoneDuration } from "./live-duration";

/**
 * The live page's duration line was "3y 4m 22d" in every language, and its
 * arithmetic used local-time getters on UTC-midnight dates.
 */
const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

describe("milestoneDuration", () => {
  it("counts years, months and days between the first and last date", () => {
    expect(milestoneDuration(["2022-09-03", "2019-04-12", "2020-06-20"])).toEqual({ years: 3, months: 4, days: 22 });
  });

  it("borrows the days of the month before the last date", () => {
    expect(milestoneDuration(["2020-01-31", "2020-03-01"])).toEqual({ years: 0, months: 1, days: 1 });
  });

  it("is the same west of UTC", () => {
    // Node reads TZ from process.env inside the process (not from a Windows
    // shell), so it is set here.
    process.env.TZ = "America/Los_Angeles";
    expect(milestoneDuration(["2020-01-31", "2020-03-01"])).toEqual({ years: 0, months: 1, days: 1 });
    expect(milestoneDuration(["2019-04-01", "2019-05-01"])).toEqual({ years: 0, months: 1, days: 0 });
  });

  it("never goes negative at a month's end", () => {
    expect(milestoneDuration(["2021-01-31", "2021-03-01"])).toEqual({ years: 0, months: 1, days: 1 });
    expect(milestoneDuration(["2019-08-31", "2020-02-29"])).toEqual({ years: 0, months: 6, days: 0 });
    expect(milestoneDuration(["2020-02-29", "2021-02-28"])).toEqual({ years: 1, months: 0, days: 0 });
    expect(milestoneDuration(["2020-02-29", "2024-02-29"])).toEqual({ years: 4, months: 0, days: 0 });
  });

  it("needs two valid dates", () => {
    expect(milestoneDuration(["2019-04-12"])).toBeNull();
    expect(milestoneDuration(["2019-04-12", undefined, ""])).toBeNull();
    expect(milestoneDuration(["2019-04-12", "not a date"])).toBeNull();
  });
});

describe("formatDuration", () => {
  const d = { years: 3, months: 4, days: 22 };

  // Locales put non-breaking spaces between number and unit.
  const plain = (s: string) => s.replace(/\s/g, " ");

  it("speaks the page's language", () => {
    expect(plain(formatDuration(d, "en"))).toMatch(/^3 years, 4 months,? and 22 days$/);
    expect(plain(formatDuration(d, "fr"))).toBe("3 ans, 4 mois et 22 jours");
    const ar = formatDuration(d, "ar");
    expect(ar).toContain("سنوات");
    expect(ar).toContain("أشهر");
    expect(ar).not.toMatch(/[a-z]/i);
  });

  it("never abbreviates to y/m/d", () => {
    for (const locale of ["en", "fr", "ar"]) expect(formatDuration(d, locale)).not.toMatch(/\d+[ymd]\b/);
  });

  it("leaves out zero parts and uses singular forms", () => {
    expect(formatDuration({ years: 1, months: 0, days: 1 }, "en")).toBe("1 year and 1 day");
    expect(formatDuration({ years: 0, months: 0, days: 0 }, "en")).toBe("");
  });
});
