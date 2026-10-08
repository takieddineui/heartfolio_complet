import { describe, expect, it } from "vitest";
import { getAllProducts, getProductById } from "@/lib/products/registry";

/**
 * ---------------------------------------------------------------------
 * "OTHER PRODUCTS" MUST NOT SHOW THE ONE JUST BOUGHT — OR A WITHDRAWN ONE
 * ---------------------------------------------------------------------
 * §10 asks for other products below the confirmation. §1 then reduced the
 * catalog to one, so the honest current answer is "none" — and a section
 * heading above an empty space, or above the item already in the
 * customer's hands, is worse than no section.
 *
 * These assert the filtering rather than the rendering, because the
 * filtering is what would break silently when the catalog changes.
 */
const othersFor = (purchasedProductId: string) => {
  const purchased = getProductById(purchasedProductId);
  return getAllProducts().filter(
    (p) => p.id !== purchased?.id && p.id !== purchasedProductId
  );
};

describe("other products (§10)", () => {
  it("shows nothing when the catalog has only one visible product", () => {
    // The full arc, in case a future reader only sees one snapshot of it:
    // §1 reduced the catalog to one visible product ("shows nothing" was
    // the honest answer); Phase 2 integration (registry.ts) then added
    // song-poster back as a second one, making "shows the other product"
    // the honest answer instead; song-poster's `status` flip was then
    // itself reverted, and — because `status` alone proved not to be a
    // working kill switch (Django's own unchanged "available" row for it
    // overrode the registry's status) — `hidden: true` was added too.
    // The catalog is back down to one visible product, so this is back to
    // being the correct assertion, not a regression to an old bug.
    const others = othersFor("love-story-timeline").map((p) => p.id);
    expect(others).toEqual([]);
  });

  it("never offers a withdrawn product (§1, §14)", () => {
    // Even for an order whose product is itself withdrawn, which is
    // possible: Django still sells heart-map (and song-poster), the
    // storefront does not.
    //
    // song-poster added back to the inner "hidden" list: hidden again
    // (see the test above for the full history) — asserting its absence
    // here is the current, correct behaviour, not the old bug.
    //
    // star-map: deleted from the registry outright now, not merely
    // hidden. Both usages below remain valid regardless — as a
    // `purchased` id, this covers a real scenario (an order placed
    // before the deletion still needs its own "other products" section
    // to behave sensibly); in the inner list, a deleted product is still
    // correctly absent from every result, same as a hidden one.
    for (const purchased of ["love-story-timeline", "heart-map", "star-map"]) {
      const slugs = othersFor(purchased).map((p) => p.slug);
      for (const hidden of ["star-map", "where-we-met", "song-poster"]) {
        expect(slugs).not.toContain(hidden);
      }
    }
  });

  it("excludes the purchased product by its Django id, not its slug", () => {
    // An order records `heart-map`; the public slug is `where-we-met`.
    // Matching on slug would silently fail to exclude exactly those
    // products whose two identifiers differ.
    expect(othersFor("heart-map").map((p) => p.id)).not.toContain("heart-map");
  });
});
