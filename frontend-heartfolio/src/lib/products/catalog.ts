/**
 * ---------------------------------------------------------------------
 * WHERE DJANGO'S CATALOG MEETS THE FRONTEND PRODUCT REGISTRY
 * ---------------------------------------------------------------------
 * Two halves, one product, and a deliberate split of ownership:
 *
 *   Django owns     — availability, prices, delivery packs, included targets
 *   The registry owns — public slug, artwork, icon, i18n keys, order, tags
 *
 * Neither is a subset of the other, and neither should grow into the
 * other's territory: the approved 8-table schema has no column for a
 * lucide icon name, and a hardcoded price in the frontend is a price that
 * will eventually disagree with what Paddle charges.
 *
 * MERGE, DON'T REPLACE. `GET /products/` only returns `available` products,
 * so Star Map and Song Poster are legitimately absent — they have no
 * database rows at all. A product with no Django entry keeps its registry
 * data untouched and stays on the waitlist path, which is exactly right:
 * they aren't purchasable, so there is no commercial truth to defer to.
 */

import type { ApiDeliveryPack, ApiProduct, ApiProductDetail } from "@/lib/api/products";
import type { DeliveryPack } from "@/types/commerce";
import { groupPacksForPresentation } from "@/lib/commerce/pack-presentation";
import { toBackendProductId } from "./product-id";
import {
  getAllProducts,
  getAvailableOfferings,
  getProductBySlug,
  getProductsByOccasion,
  OCCASION_KEYS,
} from "./registry";
import type { OfferingType, ProductEntry, ProductOffering } from "./types";

export interface CatalogProduct extends ProductEntry {
  /** True when Django returned this product — i.e. it is really purchasable.
   * False for registry-only products (waitlist), which keep their static
   * marketing offerings because no backend truth exists to defer to. */
  readonly isLive: boolean;
  /** Django's `starting_price_cents` — the "From $8" figure. Present on the
   * LIST response, which carries no packs, so it is the only commercial
   * price available in a grid context. `null` for registry-only products,
   * where the static marketing offerings remain the only figure and there
   * is no backend truth to contradict them. */
  readonly startingPriceCents: number | null;
  /** Django's delivery packs, verbatim. The authoritative thing to create an
   * order from — `slug` here is what `POST /orders/ {deliveryPackId}` wants. */
  readonly deliveryPacks: ApiDeliveryPack[];
}

/**
 * How a Django delivery pack surfaces as one of the product page's existing
 * offering cards. This mapping exists so the storefront's approved UI —
 * its offering names, descriptions and file-detail copy, already translated
 * in all three locales — keeps rendering unchanged while the *prices and
 * availability* behind it come from the database.
 *
 * `live` maps to `digital` because that is the same thing described to two
 * audiences: the backend calls the hosted/interactive deliverable `__live__`,
 * the storefront has always called it the Digital Keepsake.
 *
 * A pack slug with no entry here (e.g. `social`, which has backend support
 * and Love Story Timeline module copy but no storefront offering wording in
 * any locale) is intentionally not rendered as a marketing card. It is NOT
 * dropped from `deliveryPacks`, so if it is ever added to the catalog it
 * remains sellable in checkout — it simply doesn't advertise itself on a
 * page that has no copy for it. Flagged rather than invented.
 */
const PACK_SLUG_TO_OFFERING: Record<string, { type: OfferingType; detailsKey: string }> = {
  printable: { type: "printable", detailsKey: "printableFiles" },
  wallpaper: { type: "wallpaper", detailsKey: "wallpaperFiles" },
  live: { type: "digital", detailsKey: "digitalExperience" },
  "printable-plus-digital": { type: "printable_plus_digital", detailsKey: "printableDigitalFiles" },
  complete: { type: "complete_pack", detailsKey: "completeFiles" },
};

/** Pack slugs the backend can sell but the storefront has no copy for. */
export function unmappedPackSlugs(packs: ApiDeliveryPack[]): string[] {
  return packs.filter((pack) => !PACK_SLUG_TO_OFFERING[pack.slug]).map((pack) => pack.slug);
}

function packToOffering(pack: ApiDeliveryPack): ProductOffering | null {
  const mapping = PACK_SLUG_TO_OFFERING[pack.slug];
  if (!mapping) return null;

  return {
    type: mapping.type,
    i18nKey: mapping.type,
    // Cents are the database's unit; the storefront formats a plain number.
    // Kept exact rather than rounded — a 1250 pack must render as $12.50.
    price: pack.priceCents / 100,
    currency: pack.currency,
    detailsKey: mapping.detailsKey,
    available: pack.status === "active",
    // No preview imagery exists for any offering yet (tracked in the
    // registry's own asset TODO block). Not an API concern.
    media: null,
  };
}

/**
 * The storefront's deliberate offering order, preserved.
 *
 * Django returns delivery packs ordered by slug (`complete`, `printable`,
 * `wallpaper` — see `list_active_delivery_packs_for_product`), which is
 * alphabetical, not commercial. The approved product page has always led
 * with the Digital Keepsake and built up to the Complete Pack. Rendering
 * packs in the API's order would silently reshuffle the offering cards on
 * a page whose layout is signed off, so display order stays a presentation
 * concern — exactly the ownership split described at the top of this file.
 *
 * This orders only what is already shown; it never adds or hides anything.
 */
const OFFERING_DISPLAY_ORDER: OfferingType[] = [
  "digital",
  "wallpaper",
  "printable",
  "printable_plus_digital",
  "complete_pack",
];

function byDisplayOrder(a: ProductOffering, b: ProductOffering): number {
  const rank = (offering: ProductOffering) => {
    const index = OFFERING_DISPLAY_ORDER.indexOf(offering.type);
    // Anything not in the list sorts last rather than jumping to the front.
    return index === -1 ? OFFERING_DISPLAY_ORDER.length : index;
  };
  return rank(a) - rank(b);
}

/**
 * Joins one Django product detail response onto its registry entry.
 * Presentation stays the registry's; everything commercial becomes Django's.
 */
export function toCatalogProduct(entry: ProductEntry, detail: ApiProductDetail): CatalogProduct {
  const offerings = detail.deliveryPacks
    .map(packToOffering)
    .filter((offering): offering is ProductOffering => offering !== null)
    .sort(byDisplayOrder);

  return {
    ...entry,
    // Django's status wins outright: it decides what can be bought.
    status: detail.product.status,
    offerings,
    isLive: true,
    startingPriceCents: detail.product.startingPriceCents,
    deliveryPacks: detail.deliveryPacks,
  };
}

/** A registry-only product (no Django row): unchanged, and marked not-live. */
export function toRegistryOnlyProduct(entry: ProductEntry): CatalogProduct {
  return { ...entry, isLive: false, startingPriceCents: null, deliveryPacks: [] };
}

function toCommercePack(pack: ApiDeliveryPack): DeliveryPack {
  return {
    id: pack.slug,
    productId: pack.productId,
    nameKey: pack.nameKey,
    descriptionKey: pack.descriptionKey,
    priceCents: pack.priceCents,
    currency: pack.currency,
    includedTargets: pack.includedTargets,
  };
}

/**
 * ---------------------------------------------------------------------
 * THE PRODUCT PAGE'S OWN VIEW: THREE PRIMARY EDITIONS, WALLPAPER AS AN ADD-ON
 * ---------------------------------------------------------------------
 * `toCatalogProduct`'s `offerings` field above is a straight per-pack
 * mapping — every sellable `DeliveryPack` the storefront has copy for gets
 * its own card. That is the right shape for the Merchant Center feed (one
 * item per purchasable pack) and for this page's own JSON-LD, which is why
 * it is left alone here.
 *
 * The product page's "Available versions" section presents commerce
 * differently: three primary editions (Digital, Printable, Complete), with
 * the wallpaper-combo packs folded into an add-on line rather than shown as
 * their own cards. Checkout already made exactly this call —
 * `groupPacksForPresentation` in `lib/commerce/pack-presentation.ts` is the
 * source of truth for which packs are primary and which pack is a given
 * primary's wallpaper combo — so it is reused here rather than re-derived.
 * The standalone `wallpaper` pack (neither a primary slug nor a combo slug)
 * is excluded by that same function, regardless of its `status` in Django —
 * see `groupPacksForPresentation`'s own doc comment.
 *
 * Deliberately a SEPARATE function from `offerings` above rather than a
 * replacement for it: changing what `offerings` contains would also change
 * the merchant feed and the on-page JSON-LD `Offer` list, an unrelated
 * surface this has no reason to touch.
 */
export function getProductPageOfferings(product: CatalogProduct): ProductOffering[] {
  if (!product.isLive) {
    // No Django packs exist to group for a registry-only (waitlist)
    // product — same static marketing offerings the page has always shown.
    return getAvailableOfferings(product);
  }

  const bySlug = new Map(product.deliveryPacks.map((pack) => [pack.slug, pack]));
  const { primary, wallpaperAddonFor } = groupPacksForPresentation(
    product.deliveryPacks.map(toCommercePack)
  );

  return primary
    .map((commercePack): ProductOffering | null => {
      const pack = bySlug.get(commercePack.id);
      const mapping = PACK_SLUG_TO_OFFERING[commercePack.id];
      if (!pack || !mapping) return null;

      const comboRef = wallpaperAddonFor[commercePack.id];
      const combo = comboRef ? bySlug.get(comboRef.id) : undefined;

      return {
        type: mapping.type,
        i18nKey: mapping.type,
        price: pack.priceCents / 100,
        currency: pack.currency,
        detailsKey: mapping.detailsKey,
        available: pack.status === "active",
        media: null,
        // Real database delta, not a hardcoded $5 — see the note on
        // `wallpaperAddon` in types.ts. `null` when this primary pack has
        // no combo pack in the response at all (e.g. mid-migration).
        wallpaperAddon: combo
          ? { price: (combo.priceCents - pack.priceCents) / 100, available: combo.status === "active" }
          : null,
      };
    })
    .filter((offering): offering is ProductOffering => offering !== null && offering.available)
    .sort(byDisplayOrder);
}

/**
 * The "From $X" figure, in display units.
 *
 * For a live product this is Django's `starting_price_cents` — never derived
 * from the registry, which must not hold commercial prices. For a
 * registry-only product (waitlist) it falls back to the cheapest static
 * marketing offering, which is all that exists and contradicts nothing.
 */
export function getCatalogStartingPrice(product: CatalogProduct): number | null {
  if (product.isLive) {
    return product.startingPriceCents === null ? null : product.startingPriceCents / 100;
  }
  const prices = product.offerings.filter((o) => o.available).map((o) => o.price);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * The lowest "From $X" across the catalog, with its currency: the home
 * page's single starting price. From Django's figures (`getCatalogStartingPrice`),
 * since the registry holds no prices (every product's `offerings` is empty,
 * which is why this read "Starting at —" until 25 Oct 2026).
 */
export function lowestCatalogStartingPrice(products: CatalogProduct[]): { amount: number; currency: string } | null {
  let lowest: { amount: number; currency: string } | null = null;
  for (const product of products) {
    const price = getCatalogStartingPrice(product);
    if (price !== null && (lowest === null || price < lowest.amount)) {
      lowest = { amount: price, currency: product.currency };
    }
  }
  return lowest;
}

/**
 * Merges the `GET /products/` list over the full registry.
 *
 * Ordering, artwork and i18n keys come from the registry (Django's `order`
 * is not used — the storefront's display order is a presentation decision).
 * Products Django lists get its status; products it doesn't are returned
 * untouched.
 */
export function mergeProductList(apiProducts: ApiProduct[]): CatalogProduct[] {
  const byBackendId = new Map(apiProducts.map((product) => [product.slug, product]));

  return getAllProducts().map((entry) => {
    const apiProduct = byBackendId.get(toBackendProductId(entry));
    if (!apiProduct) return toRegistryOnlyProduct(entry);

    return {
      ...entry,
      status: apiProduct.status,
      isLive: true,
      startingPriceCents: apiProduct.startingPriceCents,
      // The list endpoint carries no packs — only the detail endpoint does.
      // Offerings therefore stay as the registry has them until a detail
      // fetch fills them in; `startingPriceCents` below is what the list
      // view actually needs.
      deliveryPacks: [],
    };
  });
}

/**
 * Resolves a public URL slug to its registry entry. Kept here so callers
 * don't reach past the catalog layer into the registry for routing.
 */
export function getEntryByPublicSlug(slug: string | undefined | null): ProductEntry | undefined {
  return getProductBySlug(slug);
}

/**
 * ---------------------------------------------------------------------
 * WHICH OCCASIONS ACTUALLY HAVE SOMETHING BEHIND THEM (§11)
 * ---------------------------------------------------------------------
 * The homepage's Gift Occasions cards were a static list of five. Every one
 * linked to `/products?occasion=<key>`, and three of them now land on an
 * empty grid: New Baby, In Memory and New Chapter were backed by products
 * that are either withdrawn (§1) or were never built. An occasion card that
 * promises "Explore new baby keepsakes" and delivers nothing is a worse
 * outcome than no card.
 *
 * So an occasion is shown only when a currently purchasable product carries
 * one of its tags. Two conditions, both required:
 *   - the product survives `getProductsByOccasion`, which reads the visible
 *     registry and therefore already excludes hidden products (§14); and
 *   - Django's status for it is `available`.
 *
 * The second condition is what makes this "reflect what's actually live"
 * rather than "reflect what the registry says" — a pack pulled from sale in
 * the database removes its occasion from the homepage with no deploy.
 *
 * SAFE UNDER AN OUTAGE, deliberately: when Django is unreachable
 * `mergeProductList` leaves the registry's own status in place, so the
 * active product still reads `available` and its occasions still render.
 * A backend blip empties neither the storefront nor this section.
 */
export function getAvailableOccasions(
  products: CatalogProduct[],
  /**
   * §7d — dashboard-managed occasions, when Django supplied them.
   *
   * Optional, and falling back to the static `OCCASION_KEYS` is not a
   * convenience: an outage, or a backend still serving the old response
   * shape, would otherwise empty the homepage's occasion section entirely.
   * That is the same reasoning as §1's hidden-product flag — a transient
   * backend problem must not look like a deliberate content decision.
   *
   * When managed occasions ARE present they replace the static list rather
   * than merging with it. Merging would mean an occasion deleted in the
   * dashboard kept appearing because the code still knew about it, which
   * defeats the point of making them editable.
   */
  managed?: { key: string; tags: string[] }[]
): string[] {
  const purchasable = products.filter((product) => product.status === "available");
  if (purchasable.length === 0) return [];

  if (managed && managed.length > 0) {
    return managed
      .filter((occasion) => {
        const tags = new Set(occasion.tags ?? []);
        return purchasable.some((product) =>
          (getProductBySlug(product.slug)?.tags ?? []).some((tag) => tags.has(tag))
        );
      })
      .map((occasion) => occasion.key);
  }

  return OCCASION_KEYS.filter((key) => {
    const slugsForOccasion = new Set(getProductsByOccasion(key).map((entry) => entry.slug));
    return purchasable.some((product) => slugsForOccasion.has(product.slug));
  });
}

/**
 * Occasion filtering over hydrated products. Delegates the tag matching to
 * the registry — occasion tags are presentation metadata and stay there —
 * and simply keeps the catalog products whose slug survived the filter.
 * Written this way so the filter rules exist in exactly one place.
 */
export function filterCatalogByOccasion(
  products: CatalogProduct[],
  occasion: string | undefined | null
): CatalogProduct[] {
  if (!occasion) return products;
  const allowed = new Set(getProductsByOccasion(occasion).map((entry) => entry.slug));
  return products.filter((product) => allowed.has(product.slug));
}

/**
 * Featured products, using the same rule as the registry's
 * `getFeaturedProducts()` — `featured` is presentation metadata, but
 * `status` is Django's, so this must run over hydrated products. A product
 * Django has disabled disappears from the homepage without a deploy.
 */
export function getFeaturedCatalogProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter((product) => product.featured && product.status !== "disabled");
}
