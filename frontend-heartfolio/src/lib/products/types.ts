/**
 * Product Registry — the single source of truth for every Heartfolio
 * product. The landing page's collection section, the product pages, and
 * (later) the Studio all read from this same list.
 *
 * TEXT CONTENT (names, descriptions, offering copy) is NOT stored here —
 * it lives in `src/messages/{en,fr,ar}.json` under `Products.<i18nKey>.*`
 * so every product is translated like the rest of the site. Read it with
 * `useProductContent` / `getProductContent`, never inline in a component.
 *
 * ---------------------------------------------------------------------
 * FUTURE BACKEND SHAPE (brief §5, §16)
 * ---------------------------------------------------------------------
 * Nothing here talks to Django, and nothing should until the products API
 * exists. But the shape below is deliberately the shape an API response
 * would have, so the swap is one function, not a refactor:
 *
 *   getAllProducts()   ->  GET /api/products
 *   getProductBySlug() ->  GET /api/products/:slug
 *
 * Both already return plain serialisable data with no UI imports, so a
 * future `async` version can be dropped in behind the same call sites.
 * Do NOT add React, lucide, or Next imports to this file or registry.ts.
 */

export type ProductStatus = "available" | "waitlist" | "coming_soon" | "disabled";

export type ProductCategory =
  | "sky"
  | "map"
  | "music"
  | "timeline"
  | "portrait"
  | "memorial"
  | "other";

/** Keys into `Products.badges.<key>` — add new ones there and here together. */
export type ProductBadgeKey = "mostGifted" | "new";

/**
 * The kinds of experience a keepsake can be delivered as. NOT every
 * product offers every kind (brief §11) — a product page must render
 * only the offerings present in its own `offerings` array.
 */
export type OfferingType =
  | "digital"
  | "printable"
  | "wallpaper"
  | "ar"
  | "vr"
  | "printable_plus_digital"
  | "complete_pack";

export interface ProductOffering {
  type: OfferingType;
  /**
   * Matches `Products.offerings.<type>.name` / `.description` in messages
   * — the shared, generic copy used when a product has nothing more
   * specific to say. Customer-facing language ("Digital Keepsake"), never
   * a file format.
   *
   * "Digital" does not mean the same thing for every product (a Love
   * Story Timeline's digital experience is not a Where We Met's), so a
   * product can override just its own Digital line by adding
   * `Products.<i18nKey>.offerings.digital.description` in messages —
   * `product-view.tsx` checks that key first and falls back to this
   * shared one. Only add a product-level override when the generic
   * wording is actually wrong for that product; most offerings (a
   * Printable Edition, a Phone Wallpaper) are fine with the shared copy.
   */
  i18nKey: OfferingType;
  /** Numeric so it can be formatted, compared and fed to Schema.org
   * `Offer.price` without string parsing. Display via `formatPrice()`. */
  price: number;
  /** ISO-4217. USD only for now — public prices are quoted in USD (§15). */
  currency: string;
  /** Concrete file/technical detail shown *underneath* the friendly name,
   * as a key into `Products.offeringDetails.<key>`. Optional: an AR/VR
   * experience has no file list. */
  detailsKey?: string;
  /** `false` hides the offering entirely — never render a greyed-out
   * variant the customer cannot buy. */
  available: boolean;
  /** Preview media path under /public. `null` = no asset exists yet and
   * the UI falls back to the product's generated artwork. See the TODO
   * block at the bottom of registry.ts for what still needs producing. */
  media: string | null;
  /**
   * Real, database-derived cost to upgrade this offering to its matching
   * wallpaper-combo pack (e.g. Printable -> Printable + Wallpaper),
   * computed as the combo pack's price minus this offering's own price —
   * never a hardcoded delta. `null`/absent when this offering has no
   * combo pack (Complete already includes wallpaper targets, so there is
   * nothing to add). Only set by `getProductPageOfferings()` in
   * catalog.ts; every other producer of a `ProductOffering` (the static
   * registry, `packToOffering`) leaves this unset.
   */
  wallpaperAddon?: { price: number; available: boolean } | null;
}

export interface ProductEntry {
  /**
   * The stable, permanent identity of this product. Written to
   * `waitlist_entries.product_id` in Supabase and keys the product's
   * captures (`public/captures/manifest.json`) — it must never change, even
   * when the public name or URL does. `where-we-met`'s `id` is still
   * `"heart-map"` for exactly this reason: changing it would orphan every
   * existing waitlist row silently (no error, just unmatched data).
   */
  id: string;
  /** URL segment: /{locale}/products/{slug}. Renameable — see `previousSlugs`. */
  slug: string;
  /**
   * Slugs this product has been published under previously. Renaming a
   * live product (e.g. `heart-map` → `where-we-met`) means the old URL is
   * indexed and may be bookmarked or linked externally — list it here and
   * `next.config.ts` turns it into a permanent redirect automatically.
   * `id` never changes even when `slug` does (see the note on `id`).
   */
  previousSlugs?: string[];
  /** Matches `Products.<i18nKey>` in every locale's messages file. */
  i18nKey: string;
  category: ProductCategory;
  /** ISO-4217 currency for this product's offerings. */
  currency: string;
  /** Path under /public for this product page's OG image. `null` falls
   * back to the site-wide image — but §32 asks for per-product art, so a
   * null here is a tracked gap, not a design choice. */
  ogImage: string | null;
  /** lucide-react icon name, kept as a string so this file has no
   * UI-library imports. */
  icon: string;
  featured: boolean;
  badgeKey?: ProductBadgeKey;
  status: ProductStatus;
  /**
   * ---------------------------------------------------------------------
   * WITHDRAWN FROM THE SITE ENTIRELY (§1, §14)
   * ---------------------------------------------------------------------
   * `true` means this product must behave as if it does not exist: no card,
   * no product page (a real 404), no sitemap entry, no slug redirect, no
   * "you might also like", no Studio route. Not "unlisted" — gone.
   *
   * WHY THIS IS A STATIC FLAG AND NOT DJANGO'S `status`, which is the more
   * obvious place for it: the frontend cannot tell "Django says this product
   * isn't available" apart from "Django didn't answer". `catalog-server.ts`
   * routes both outcomes to `toRegistryOnlyProduct()`, by design — a backend
   * cold start must not empty the storefront. If hiding were inferred from
   * the backend's answer, a transient blip would 404 the *live* product and
   * tell crawlers its page no longer exists. So visibility is decided here,
   * where it cannot be affected by the network, and Django stays the sole
   * authority over what is *purchasable* — prices, packs, availability.
   *
   * The cost of that choice, stated plainly: unhiding a product needs a
   * deploy, not a database edit. That was the accepted trade.
   *
   * Entries are kept rather than deleted so the decision stays reversible
   * and their translations survive; `hidden` is what enforces it.
   */
  hidden?: boolean;
  /** Lower sorts first. */
  order: number;
  tags: string[];
  offerings: ProductOffering[];
  /** How many FAQ entries exist under `Products.<i18nKey>.faq` — keeps
   * the rendered FAQ and its FAQPage structured data in lockstep
   * (§29: structured data must match visible content). */
  faqCount: number;
}
