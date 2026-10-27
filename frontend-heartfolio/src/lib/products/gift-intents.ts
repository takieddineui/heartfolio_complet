import { getAllProducts } from "@/lib/products/registry";
import type { ProductEntry } from "@/lib/products/types";

/**
 * ---------------------------------------------------------------------
 * GIFT-INTENT LANDING PAGES (§16c)
 * ---------------------------------------------------------------------
 * Pages organised around what someone is shopping *for* — "printable
 * gifts", "anniversary gifts" — rather than around a single product, each
 * linking to whichever products actually match.
 *
 * DERIVED, NEVER DECLARED. Every intent below defines a predicate over the
 * live catalog rather than a hand-written product list. §16c is explicit
 * that these are constrained by §11 and §14: a hidden product must never
 * surface through one of these pages, and the set of pages that make sense
 * shrinks and grows with the active catalog. `getAllProducts()` already
 * excludes hidden products, so that guarantee is inherited rather than
 * re-implemented — the same filter that protects the homepage, the
 * collection page, the sitemap and the Merchant Center feed.
 *
 * An intent with no matching products has no page: `enabledIntents()`
 * returns nothing for it, `generateStaticParams` never builds it, the
 * sitemap never lists it, and the route 404s. A landing page promising
 * "printable gifts" above an empty grid is worse than no page, and it is
 * the same failure §11 removed from the homepage's occasion cards.
 *
 * WHY MOST OF THESE ARE DEFINED BUT SWITCHED OFF
 * -----------------------------------------------
 * All four are described here so the shape is settled and turning one on
 * later is a one-line change. Only `enabled: true` ones are built.
 *
 * That restraint is deliberate and it is about the current catalog size.
 * With one active product, four intent pages would each list the same
 * single item and differ only in a heading and an intro — which is the
 * shape search engines treat as doorway pages, and the penalty for that
 * falls on the whole domain rather than the offending URLs. One page that
 * says something `/products` does not already say is worth more than four
 * that repeat each other. As the catalog grows and the pages start
 * genuinely differing, the others can be switched on.
 */

export interface GiftIntent {
  /** URL segment: /gifts/<slug> */
  slug: string;
  /** Live today. See the note above on why most are not. */
  enabled: boolean;
  /** Resolved against the `GiftIntents.<key>` message namespace. */
  i18nKey: string;
  /** Decides which live products belong on this page. */
  matches: (product: ProductEntry) => boolean;
}

/** True when a product sells anything printed — see §2/§3. */
/**
 * Sells a Printable pack: the `printable` tag (27 Oct 2026). It used to
 * guess from "timeline" or "map", which left out Song Poster, sold as a
 * print since 19 Oct 2026, so the printable-gifts page showed one product.
 * `gift-intents.test.ts` pins the tag to `seed_catalog.py`'s active packs.
 */
function hasPrintDeliverable(product: ProductEntry): boolean {
  return (product.tags ?? []).includes("printable");
}

export const GIFT_INTENTS: GiftIntent[] = [
  {
    // The one live page. Chosen because "printable" says something the
    // collection page does not: it answers what you physically end up with,
    // which is the question a gift-buyer actually has.
    slug: "printable-gifts",
    enabled: true,
    i18nKey: "printableGifts",
    matches: hasPrintDeliverable,
  },
  {
    slug: "anniversary-gifts",
    enabled: false,
    i18nKey: "anniversaryGifts",
    matches: (product) => (product.tags ?? []).includes("anniversary"),
  },
  {
    slug: "wedding-gifts",
    enabled: false,
    i18nKey: "weddingGifts",
    matches: (product) => (product.tags ?? []).includes("wedding"),
  },
  {
    slug: "gifts-for-couples",
    enabled: false,
    i18nKey: "giftsForCouples",
    matches: (product) => {
      const tags = product.tags ?? [];
      return tags.includes("anniversary") || tags.includes("wedding");
    },
  },
];

/** Products backing an intent. Hidden products cannot appear (§14). */
export function productsForIntent(intent: GiftIntent): ProductEntry[] {
  return getAllProducts().filter(intent.matches);
}

/**
 * The intents that should actually have a page right now: switched on AND
 * backed by at least one live product. Both conditions, because a page can
 * be intended and still have nothing to show.
 */
export function enabledIntents(): GiftIntent[] {
  return GIFT_INTENTS.filter(
    (intent) => intent.enabled && productsForIntent(intent).length > 0
  );
}

export function findIntent(slug: string): GiftIntent | undefined {
  return enabledIntents().find((intent) => intent.slug === slug);
}
