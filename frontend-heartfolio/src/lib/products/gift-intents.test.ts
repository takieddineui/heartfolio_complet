import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { GIFT_INTENTS, enabledIntents, findIntent, productsForIntent } from "./gift-intents";

/**
 * ---------------------------------------------------------------------
 * §16c — a landing page must never promise products it cannot show
 * ---------------------------------------------------------------------
 * §16c is explicit that these pages are constrained by §11 and §14: a
 * hidden product must not surface through one, and the set of pages that
 * make sense changes with the catalog. Both failures are silent — a page
 * renders fine with an empty grid, and a withdrawn product looks like any
 * other card — so they need asserting rather than reviewing.
 */
describe("gift intents (§16c)", () => {
  it("never surfaces a withdrawn product", () => {
    // Inherited from `getAllProducts()`, the same filter protecting the
    // homepage, the sitemap and the Merchant Center feed (§14).
    //
    // song-poster removed from this list: it is visible now (Phase 2
    // integration flip, registry.ts), and genuinely matches the
    // anniversary-gifts / gifts-for-couples intents via its own real
    // "anniversary" tag — that is correct inclusion, not a withdrawal
    // leak, so it must not be asserted absent here any more.
    for (const intent of GIFT_INTENTS) {
      const slugs = productsForIntent(intent).map((p) => p.slug);
      // star-map: deleted from the registry outright now, not merely
      // hidden — the assertion still holds for the same reason it did
      // before (a product that isn't in `getAllProducts()` at all can
      // never appear in any intent's filtered list either).
      for (const hidden of ["star-map", "where-we-met"]) {
        expect(slugs).not.toContain(hidden);
      }
    }
  });

  it("only enables intents that have products behind them", () => {
    // Both conditions matter: an intent can be switched on and still have
    // nothing to show, which is a page promising an empty grid.
    for (const intent of enabledIntents()) {
      expect(intent.enabled).toBe(true);
      expect(productsForIntent(intent).length).toBeGreaterThan(0);
    }
  });

  it("has exactly one page live today", () => {
    // Deliberate restraint: with one product, four intent pages would each
    // list the same item and differ only in a heading — the shape search
    // engines treat as doorway pages, penalised across the whole domain.
    expect(enabledIntents().map((i) => i.slug)).toEqual(["printable-gifts"]);
  });

  it("refuses to resolve a disabled or unknown intent", () => {
    // What makes the route 404 rather than render an empty page.
    expect(findIntent("anniversary-gifts")).toBeUndefined();
    expect(findIntent("not-a-real-intent")).toBeUndefined();
    expect(findIntent("printable-gifts")).toBeDefined();
  });

  it("gives every defined intent copy in all three locales", () => {
    // Including the disabled ones: switching one on later must be a
    // one-line change, not a change plus three translations discovered at
    // the moment of launch.
    for (const [locale, messages] of Object.entries({ en, fr, ar })) {
      const block = (messages as unknown as {
        GiftIntents: Record<string, { title: string; intro: string; meta: { title: string; description: string } }>;
      }).GiftIntents;

      for (const intent of GIFT_INTENTS) {
        const copy = block[intent.i18nKey];
        expect(copy, `${locale} is missing GiftIntents.${intent.i18nKey}`).toBeTruthy();
        expect(copy!.title).toBeTruthy();
        expect(copy!.intro).toBeTruthy();
        expect(copy!.meta.description).toBeTruthy();
      }
    }
  });

  it("gives every intent a distinct slug and message key", () => {
    // Two intents sharing either would silently make one unreachable.
    expect(new Set(GIFT_INTENTS.map((i) => i.slug)).size).toBe(GIFT_INTENTS.length);
    expect(new Set(GIFT_INTENTS.map((i) => i.i18nKey)).size).toBe(GIFT_INTENTS.length);
  });
});
