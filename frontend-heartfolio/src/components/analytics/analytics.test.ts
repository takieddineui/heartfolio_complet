import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * ---------------------------------------------------------------------
 * CONSENT GATING (GDPR)
 * ---------------------------------------------------------------------
 * Source-level assertions, because the property that matters is an
 * absence: GA4 must not be in the DOM before someone says yes. A rendering
 * test can show that it is gated today; only reading the source shows that
 * nobody removed the gate.
 */
const analytics = readFileSync("src/components/analytics/analytics.tsx", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const banner = readFileSync("src/components/analytics/cookie-consent.tsx", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("analytics consent", () => {
  it("never mounts GA4 without an explicit grant", () => {
    // Loading it and removing it on refusal would already have set the
    // cookies and sent the first pageview. There is no undo for a request
    // that has been made.
    expect(analytics).toContain('consent === "granted"');
  });

  it("treats an undecided visitor as denied", () => {
    // Absent storage must not read as permission.
    expect(analytics).toContain('"undecided"');
    expect(analytics).not.toMatch(/consent\s*!==\s*["']denied["']/);
  });

  it("reads consent without setState inside an effect", () => {
    // §17 removed this pattern from two hooks; it was reintroduced here and
    // caught by lint. It renders once with the wrong value before
    // correcting itself, which here means flashing the banner at a visitor
    // who accepted months ago.
    expect(analytics).toContain("useSyncExternalStore");
    expect(analytics).not.toContain("useEffect");
  });

  it("runs the cookieless analytics without a gate", () => {
    // It sets no cookies and identifies nobody, so there is nothing to
    // consent to — and it is the only data that exists for the majority
    // who decline.
    // Bounded to the Plausible JSX exactly — the first slice ran past it
    // into the GA4 block, which of course mentions "granted", and the test
    // failed for a reason that had nothing to do with the property.
    const start = analytics.indexOf("plausibleDomain &&");
    const end = analytics.indexOf("gaId &&");
    const plausibleBlock = analytics.slice(start, end);

    expect(plausibleBlock).toContain("plausible.io");
    expect(plausibleBlock).not.toContain("granted");
    expect(plausibleBlock).not.toContain("consent");
  });

  it("keeps advertising signals off even after consent", () => {
    // Permission was given for measurement, not for advertising profiles.
    for (const signal of ["ad_storage", "ad_user_data", "ad_personalization"]) {
      expect(analytics).toContain(`${signal}: 'denied'`);
    }
    expect(analytics).toContain("anonymize_ip");
  });
});

describe("cookie banner", () => {
  it("offers decline and accept as equal choices", () => {
    // A greyed-out link beside a prominent Accept is the pattern regulators
    // have ruled against, and it is also dishonest.
    expect(banner).toContain('choose("denied")');
    expect(banner).toContain('choose("granted")');
    expect(banner).toContain("flex-1 sm:flex-none");
  });

  it("puts decline first in the DOM", () => {
    // It reaches a screen reader and a keyboard first, and it is the choice
    // that requires no trust.
    expect(banner.indexOf('choose("denied")')).toBeLessThan(banner.indexOf('choose("granted")'));
  });

  it("only shows while the choice is undecided", () => {
    // A banner that keeps asking after a "no" is asking someone to change
    // their mind, not asking for consent.
    //
    // The check moved from `readConsent() === "undecided"` in an effect to
    // an early return on the subscribed value, when the effect pattern was
    // replaced — same rule, read at render instead of after it.
    expect(banner).toContain('consent !== "undecided"');
    expect(banner).toContain("return null");
  });

  it("does not trap focus", () => {
    // The page underneath stays usable. Trapping focus would make an
    // optional choice mandatory for keyboard users only.
    expect(banner).not.toMatch(/focus-trap|FocusTrap|aria-modal/);
  });
});
