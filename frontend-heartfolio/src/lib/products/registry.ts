import type { ProductEntry, ProductOffering } from "./types";
import { PRICE_CURRENCY } from "../site-config";

/**
 * Every Heartfolio product lives here, and only here. To add a product:
 * append one entry AND add its `Products.<i18nKey>` block (name,
 * descriptions, meta, faq) to every locale's messages file.
 *
 * THAT ONE LINE IS NOT THE WHOLE PROCESS. Song Poster shipped a complete
 * renderer, a complete Studio module and a real, priced Django catalog —
 * and still didn't appear on the site, because this file's own `hidden`/
 * `status` fields were never flipped. See `/ADDING-A-PRODUCT.md` at the
 * repo root for the full sequence (backend renderer + catalog, Studio
 * module, THIS file, translations, and — the step that actually would
 * have caught the gap — confirming `getAllProducts()` includes the new
 * slug before calling it done).
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * This entire file is temporary/static product data. Before deployment,
 * product, offering and price data should come from the Django Products
 * API instead of this hardcoded array:
 *
 *   Django Products API → product → offerings → price → frontend
 *
 * Do not connect this now. When that API exists, `getAllProducts()` and
 * `getProductBySlug()` are the two functions to swap for real fetches —
 * every other function in this file (getFeaturedProducts,
 * getProductsByOccasion, getAvailableOfferings, getStartingPrice,
 * getCreateEntry, getStudioDestination) is written against the returned
 * shape, not against this array directly, so the swap should not require
 * touching call sites elsewhere in the app.
 *
 * ⚠️ NO PRICES LIVE HERE (§5, §13).
 * Pack prices exist in one place only: `DeliveryPack.price_cents` in the
 * database. This comment used to spell out a figure per pack "as a
 * structure" — which made code a second, silent source of pricing truth
 * that would go stale the moment a real price was set, and that someone
 * would later read as authoritative. The numbers are gone deliberately;
 * to see current prices, read the database or the storefront, both of
 * which get them from Django.
 *
 * Prices are quoted in USD only — no local-currency conversion anywhere
 * on the site (§15). Whatever is set in the database must also match the
 * Paddle catalogue, which is what actually charges the customer.
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * Before deployment, run a Paddle / Merchant-of-Record readiness audit
 * and replace these provisional prices with the final commercial catalogue.
 * Do not implement Paddle, checkout, or payment code as part of that —
 * this file only holds the price *data* the storefront displays.
 *
 * IMPORTANT — PRODUCT NAMING (confirmed, do not change):
 * Star Map and Moon Phase are separate products. Do not merge them or
 * rename Star Map to Moon Phase. Moon Phase, Birth Poster, Wedding
 * Keepsake and Pet Memorial are not yet implemented here — do not
 * fabricate their content; add them only when real product content
 * exists. Where We Met's public slug is `where-we-met`; its retired slug
 * `heart-map` is kept only in `previousSlugs` for redirect compatibility,
 * and its `id` deliberately stays `"heart-map"` — see the comment on that
 * entry below.
 */

const usd = (
  type: ProductOffering["type"],
  price: number,
  detailsKey?: string
): ProductOffering => ({
  type,
  i18nKey: type,
  price,
  currency: PRICE_CURRENCY,
  detailsKey,
  available: true,
  media: null,
});

export const PRODUCT_REGISTRY: ProductEntry[] = [
  {
    id: "song-poster",
    slug: "song-poster",
    i18nKey: "songPoster",
    category: "music",
    currency: PRICE_CURRENCY,
    ogImage: null, // TODO: /og/song-poster.png
    icon: "AudioWaveform",
    featured: true,
    // REVERTED to "coming_soon" — was "available" (see the comment this
    // replaced: "Phase 2 integration: flipped from waitlist... a real
    // Product Module exists and the Django catalog now sells it"). Django's
    // renderer/catalog/Studio module are untouched by this revert; only
    // this flag changed, so flipping it back to "available" restores
    // exactly what was here before, nothing more to redo.
    status: "coming_soon",
    /**
     * VISIBLE AGAIN since 15 Oct 2026 so the owner can open its real Studio
     * route and test it. THIS IS NOT "READY TO SELL": Song Poster has NO
     * Freemius plan in `FREEMIUS_PLAN_MAPPING`, so a customer who reaches
     * checkout uploads their media, then is refused with
     * `FreemiusPlanNotConfigured`. Either map plans for its packs or set this
     * back to `true` before the VPS goes live.
     *
     * History: hidden on 1 Oct 2026 alongside the `status` revert above,
     * because `status` alone is no kill switch here: `toCatalogProduct` in
     * `catalog.ts` lets Django's status win outright the moment the catalog
     * fetch succeeds. `hidden` is the one switch in this file Django cannot
     * undo (`isVisible()` below): no card, no product page, no sitemap
     * entry, no Studio route.
     */
    hidden: false,
    order: 2,
    tags: ["music", "anniversary", "gift"],
    faqCount: 3,
    /**
     * INTENTIONALLY EMPTY — Django owns this product's commercial data,
     * as of this flip. Same reasoning as Love Story Timeline's and Where
     * We Met's own identical comment: offerings, prices and delivery
     * packs come from `GET /products/<slug>/` at request time
     * (`lib/products/catalog.ts`), never hardcoded here. The four
     * offerings this array used to hold (`digital` at $12, `wallpaper`
     * at $8, `printable` at $18, `complete_pack` at $30) were placeholder
     * numbers from before a real renderer or catalog existed — leaving
     * them in place would mean the marketing site advertising a price
     * and pack shape that no longer match what Django actually sells
     * (printable/wallpaper/printable-plus-wallpaper/complete, priced
     * separately, no live/digital pack yet).
     */
    offerings: [],
  },
  {
    // `id` stays "heart-map" — it's written as `product_id` in existing
    // Supabase waitlist rows, and changing it would silently orphan them.
    // Only the public-facing slug and i18n key change (Pass A, §2).
    id: "heart-map",
    slug: "where-we-met",
    previousSlugs: ["heart-map"],
    i18nKey: "whereWeMet",
    category: "map",
    currency: PRICE_CURRENCY,
    ogImage: null, // TODO: /og/where-we-met.png
    icon: "MapPin",
    featured: true,
    // Phase 2 integration: flipped from "waitlist" — a real Product Module
    // (renderer, schema, themes, exports) exists and the Django catalog
    // sells it. Star Map and Song Poster deliberately stay on the waitlist.
    status: "available",
    /**
     * §1: withdrawn entirely, even though Django still lists it as
     * `available` and can still render and deliver it. That split is
     * deliberate — the backend keeps working so any order already placed
     * stays downloadable (`/orders/<id>` reads Django directly and never
     * consults this registry), while the storefront stops selling it.
     *
     * Consequence, intended: `previousSlugs: ["heart-map"]` no longer
     * produces a redirect, because `productSlugRedirects()` in
     * `next.config.ts` iterates `getAllProducts()`. `/products/heart-map`
     * therefore 404s directly instead of redirecting to a page that 404s —
     * which is the correct signal to send a crawler holding the old URL.
     */
    hidden: true,
    order: 3,
    tags: ["map", "anniversary", "wedding"],
    faqCount: 3,
    /**
     * INTENTIONALLY EMPTY — Django owns this product's commercial data.
     *
     * This product is sold through the Django catalog, so its offerings,
     * prices and delivery packs come from `GET /products/<slug>/` at request
     * time and are joined on in `lib/products/catalog.ts`. Nothing
     * commercial may live here.
     *
     * This is not tidiness. A hardcoded list here is a list that can be
     * served when Django is unreachable, which means shipping a price that
     * may be wrong — or worse, advertising a pack the backend cannot
     * deliver. Where We Met previously carried a $12 Digital offering here;
     * its renderer produces PNGs only and has no `__live__` target, so any
     * purchase of it would have failed with `renderer_not_available` AFTER
     * payment. Emptying this array is what makes that class of bug
     * impossible rather than merely unlikely.
     *
     * When the catalog is unavailable the product page renders no
     * purchasable offerings and says so. It never guesses.
     */
    offerings: [],
  },
  {
    id: "love-story-timeline",
    slug: "love-story-timeline",
    i18nKey: "loveStoryTimeline",
    category: "timeline",
    currency: PRICE_CURRENCY,
    ogImage: "/og/love-story-timeline.png",
    icon: "GalleryHorizontal",
    featured: true,
    badgeKey: "new",
    // Phase 2 integration: flipped from "coming_soon" — see the note on
    // Where We Met above.
    status: "available",
    order: 4,
    tags: ["timeline", "anniversary", "wedding", "photos"],
    faqCount: 3,
    /**
     * INTENTIONALLY EMPTY — Django owns this product's commercial data.
     *
     * This product is sold through the Django catalog, so its offerings,
     * prices and delivery packs come from `GET /products/<slug>/` at request
     * time and are joined on in `lib/products/catalog.ts`. Nothing
     * commercial may live here.
     *
     * This is not tidiness. A hardcoded list here is a list that can be
     * served when Django is unreachable, which means shipping a price that
     * may be wrong — or worse, advertising a pack the backend cannot
     * deliver. Where We Met previously carried a $12 Digital offering here;
     * its renderer produces PNGs only and has no `__live__` target, so any
     * purchase of it would have failed with `renderer_not_available` AFTER
     * payment. Emptying this array is what makes that class of bug
     * impossible rather than merely unlikely.
     *
     * When the catalog is unavailable the product page renders no
     * purchasable offerings and says so. It never guesses.
     */
    offerings: [],
  },
  {
    id: "reasons-i-love-you",
    slug: "reasons-i-love-you",
    i18nKey: "reasonsILoveYou",
    category: "other",
    currency: PRICE_CURRENCY,
    ogImage: null, // TODO: /og/reasons-i-love-you.png
    icon: "Heart",
    featured: true,
    status: "available",
    /**
     * VISIBLE since 14 Oct 2026, once it could be bought: Freemius plan 71990
     * is mapped (`reasons-i-love-you:live`) and the Django catalog row and its
     * `live` pack were seeded. It was `hidden: true` until both existed,
     * because checkout would otherwise fail with `FreemiusPlanNotConfigured`.
     * To withdraw it later, set this back to `true` (the one switch Django
     * cannot override; see Song Poster's note above).
     */
    hidden: false,
    order: 5,
    tags: ["love", "anniversary", "valentines", "gift"],
    faqCount: 3,
    /**
     * INTENTIONALLY EMPTY — Django owns this product's commercial data (one
     * `live` pack, $15.99), joined in by `lib/products/catalog.ts`. Same
     * reasoning as Love Story Timeline's note above.
     */
    offerings: [],
  },
  {
    id: "graduation-keepsake",
    slug: "graduation-keepsake",
    i18nKey: "graduationKeepsake",
    category: "other",
    currency: PRICE_CURRENCY,
    ogImage: null, // TODO: /og/graduation-keepsake.png
    icon: "GraduationCap",
    featured: false,
    status: "available",
    /**
     * VISIBLE since 15 Oct 2026: Freemius plan 72194 is mapped
     * (`graduation-keepsake:live`). Its Django catalog row and `live` pack are
     * seeded by the owner; until the seed has run, the product page has no
     * pack to sell. To withdraw it later, set this back to `true` (the one
     * switch Django cannot override; see Song Poster's note above).
     */
    hidden: false,
    order: 6,
    tags: ["graduation", "gift", "photos", "messages"],
    faqCount: 4,
    /**
     * INTENTIONALLY EMPTY — Django owns this product's commercial data (one
     * `live` pack, $15.99), joined in by `lib/products/catalog.ts`.
     */
    offerings: [],
  },
];

/**
 * ---------------------------------------------------------------------
 * HIDING IS ENFORCED HERE, ONCE (§1, §14)
 * ---------------------------------------------------------------------
 * Every product surface in the app — the homepage grid, `/products`,
 * `/create`, the footer, the pricing table, the sitemap, the Studio route
 * resolver and the slug-redirect generator in `next.config.ts` — reaches
 * the registry through `getAllProducts`, `getProductBySlug` or
 * `getProductById`. Filtering in those three functions is therefore the
 * whole implementation: a hidden product cannot appear anywhere without a
 * new call site being written that deliberately bypasses them.
 *
 * That is the point. §14 requires a hidden product to be absent from
 * places nobody thinks to check — a sitemap, an OG card, a "you might also
 * like" strip. A per-call-site `.filter()` would be one forgotten call
 * site away from failing silently, and the failure would be invisible
 * until a crawler found the page.
 */
function isVisible(product: ProductEntry): boolean {
  return product.hidden !== true;
}

export function getAllProducts(): ProductEntry[] {
  return [...PRODUCT_REGISTRY].filter(isVisible).sort((a, b) => a.order - b.order);
}

/**
 * Every entry, hidden ones included. Deliberately NOT used to render
 * anything customer-facing — it exists so tests can assert that a hidden
 * product is still *defined* (and therefore reversible) while proving it is
 * absent from every public surface. If you are reaching for this from a
 * component, the answer is almost certainly `getAllProducts()`.
 */
export function getAllProductsIncludingHidden(): ProductEntry[] {
  return [...PRODUCT_REGISTRY].sort((a, b) => a.order - b.order);
}

export function getFeaturedProducts(): ProductEntry[] {
  return getAllProducts().filter((p) => p.featured && p.status !== "disabled");
}

/**
 * ---------------------------------------------------------------------
 * OCCASION FILTERING (Pass A §9)
 * ---------------------------------------------------------------------
 * Deliberately minimal — Pass A explicitly rules out building a full
 * occasion taxonomy (dedicated routes, per-occasion schema, dedicated
 * messages) in this pass. This is just enough to make the existing Gift
 * Occasion cards land somewhere real: `/products?occasion=<key>` filters
 * the same collection grid by tag rather than dropping the visitor on an
 * unrelated page.
 *
 * The occasion keys come from `GiftOccasions` in messages, not from this
 * file — this only maps each one to the registry `tags` that represent it.
 * Some occasions (In Memory, New Chapter) have no matching product yet,
 * on purpose: Pet Memorial and a housewarming-tagged product don't exist,
 * and inventing a tag match for them would be the same mistake as
 * inventing the product itself. `getProductsByOccasion` returns an empty
 * array in that case; callers decide how to present that gracefully
 * rather than this function inventing a fallback.
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * This tag-based mapping is temporary. Eventually product/occasion
 * relationships should come from the database (occasion → products
 * linked to that occasion), not a hardcoded map of occasion keys to
 * registry tags. Do not build the fuller occasion taxonomy (dedicated
 * routes, per-occasion schema/metadata) now — that is intentionally out
 * of scope until the Products API exists.
 */
const OCCASION_TAGS: Record<string, string[]> = {
  anniversary: ["anniversary"],
  wedding: ["wedding"],
  newBaby: ["birth"],
  inMemory: ["memorial"],
  newChapter: ["housewarming"],
};

/**
 * Every occasion the site has copy for, in display order.
 *
 * Exported (§11) because "which occasions exist" and "which occasions have
 * a product behind them" are now two different questions, and the second
 * has to be computed against the live catalog rather than hardcoded in the
 * homepage component. Keeping the key list here — next to the tag mapping
 * it belongs to — means adding an occasion is still a one-file change.
 */
export const OCCASION_KEYS: string[] = Object.keys(OCCASION_TAGS);

/**
 * The occasions a product is actually for, derived from its own tags (§16b).
 *
 * §16b asks the product page to state who a keepsake is for and on what
 * occasions. Writing that into the copy by hand is how a page ends up
 * promising "perfect for a new baby" for something tagged only anniversary
 * and wedding — the exact mismatch §11 removed from the homepage, where
 * occasion cards led to empty result grids.
 *
 * Deriving it means the page can only ever claim occasions the product is
 * genuinely tagged for, and re-tagging a product updates its page with no
 * copy edit. The returned keys are the same ones `GiftOccasions` labels, so
 * the wording is shared rather than written twice.
 */
export function getOccasionsForProduct(product: ProductEntry): string[] {
  const tags = new Set(product.tags ?? []);
  return OCCASION_KEYS.filter((key) => (OCCASION_TAGS[key] ?? []).some((tag) => tags.has(tag)));
}

export function getProductsByOccasion(occasion: string | undefined | null): ProductEntry[] {
  if (!occasion) return getAllProducts();
  const tags = OCCASION_TAGS[occasion];
  if (!tags) return getAllProducts();
  return getAllProducts().filter((p) => p.tags.some((t) => tags.includes(t)));
}

/**
 * Resolves a public URL slug. A hidden product returns `undefined`, which is
 * what turns `/products/where-we-met` into a genuine 404 — the product route
 * already calls `notFound()` on an unresolved slug, so §1's "real 404, not
 * just unlisted" needs no new branch in the route itself.
 */
export function getProductBySlug(slug: string | undefined | null): ProductEntry | undefined {
  if (!slug) return undefined;
  return PRODUCT_REGISTRY.filter(isVisible).find((p) => p.slug === slug);
}

/**
 * Looks a product up by its stable id — the value Django knows it by, and
 * the key the Studio's Product Module registry uses. Deliberately separate
 * from `getProductBySlug`: the two coincide for every product except Where
 * We Met (public slug `where-we-met`, id `heart-map`), and collapsing them
 * into one lookup is what would let the Django slug leak into a public URL.
 */
export function getProductById(id: string | undefined | null): ProductEntry | undefined {
  if (!id) return undefined;
  return PRODUCT_REGISTRY.filter(isVisible).find((p) => p.id === id);
}

/** Only the offerings a customer can actually get today. */
export function getAvailableOfferings(product: ProductEntry): ProductOffering[] {
  return product.offerings.filter((o) => o.available);
}

/** Lowest available price — the "From $12 USD" figure. Derived, never
 * hardcoded, so it can never drift from the offerings list. */
export function getStartingPrice(product: ProductEntry): number | null {
  const prices = getAvailableOfferings(product).map((o) => o.price);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * ---------------------------------------------------------------------
 * TWO DESTINATIONS, NOT ONE (Pass A §8)
 * ---------------------------------------------------------------------
 * A single `getCreateDestination()` used to answer both "where does a
 * marketing CTA go?" and "where does the Continue button inside /create
 * go?" — but those are different questions with different answers.
 * Every product CTA on the marketing site (product page, header, pricing,
 * final CTA) must land on the `/create` selection gateway, never skip
 * past it into Studio or a waitlist form directly. Only the Continue
 * button *inside* `/create`, once someone has actually chosen a product,
 * goes on to Studio or the waitlist. Two functions keep that boundary
 * from blurring back together by accident.
 */

/**
 * Marketing / product-page CTA destination. Always `/create`, optionally
 * with the product preselected — never Studio, never a waitlist form
 * directly, regardless of the product's status. `/create` itself decides
 * what the Continue button does once someone lands there.
 */
export function getCreateEntry(product?: ProductEntry): { href: string } {
  if (!product) return { href: "/create" };

  /**
   * AN AVAILABLE PRODUCT GOES STRAIGHT TO STUDIO, skipping `/create`.
   *
   * This used to send everyone to `/create` regardless of status, which
   * made sense while Studio did not exist: `/create` was the only place
   * that knew what a product's status meant. Studio exists now, and the
   * consequence had become absurd — someone reading the Love Story
   * Timeline page, who had by definition already chosen the product,
   * pressed "Create yours" and landed on a product PICKER with their
   * choice pre-selected, to press Continue and confirm a decision they
   * had just made. An extra page and an extra click between wanting the
   * thing and starting it.
   *
   * ANYTHING NOT AVAILABLE STILL GOES TO `/create`, and that is the
   * important half. `/create` is the only surface that handles a
   * `waitlist` or `coming_soon` product gracefully, and it is where
   * someone compares products and changes their mind. Bypassing it for a
   * product that is ready to build is a shortcut; bypassing it entirely
   * would delete a real page of the funnel.
   */
  const destination = getStudioDestination(product);
  if (destination.type === "studio" && destination.href) {
    return { href: destination.href };
  }

  return { href: `/create?product=${product.slug}` };
}

/**
 * Where the Continue button *inside* `/create` sends someone, driven by
 * `status`. Studio is out of scope for this phase (§4/§24) —
 * `/studio/:slug` is the agreed future route and does not exist yet.
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * Before deployment, revisit the integration between product selection
 * (`/create`) and Studio itself — customization, live preview, payment,
 * generation and download all live in Studio, which is a separate project
 * phase and is not implemented or modified here. This function should
 * only need its `"studio"` branch's destination confirmed/updated once
 * Studio's real route and hand-off contract are finalized; the rest of
 * the marketing/selection flow should not need to change.
 */
export function getStudioDestination(
  product: ProductEntry
): { type: "studio" | "unavailable"; href?: string } {
  switch (product.status) {
    case "available":
      return { type: "studio", href: `/studio/${product.slug}` };
    /**
     * `/waitlist` was removed along with the three withdrawn products (§1),
     * so there is no longer a destination to send a waitlisted product to.
     * The status itself stays valid — Django's schema still allows it, and
     * a future product may legitimately carry it — but it now resolves to
     * "unavailable" rather than linking at a route that 404s. Restoring a
     * waitlist means restoring the page and this branch together.
     */
    case "waitlist":
    case "coming_soon":
    case "disabled":
    default:
      return { type: "unavailable" };
  }
}

/* ---------------------------------------------------------------------
 * ASSET TODOs (brief §7, §8, §32, §33)
 * ---------------------------------------------------------------------
 * Every product currently renders bespoke generated SVG artwork — good,
 * deliberate, and far better than stock. What does NOT yet exist, and is
 * needed before this reads as a premium collection:
 *
 * 1. Per-product OG PHOTOGRAPHY, 1200×630. Not blocking: each product page
 *    now generates its own share card (name, line, starting price, brand
 *    colours) via the `opengraph-image` routes, so nothing shares a broken
 *    or generic image. Set `ogImage` to override with real art when it
 *    exists:
 *      /og/star-map.png              — framed star map, warm dark interior
 *      /og/song-poster.png           — song poster, framed print + phone
 *      /og/where-we-met.png          — map print, editorial styling
 *      /og/love-story-timeline.png   — horizontal timeline, framed
 *
 * 2. Offering preview media (`media` is null on all offerings):
 *      Printable  — physical framed print on a wall, warm minimal interior,
 *                   editorial photography, no people, no props clutter.
 *      Wallpaper  — single smartphone on a plain surface, screen showing the
 *                   artwork, soft daylight.
 *      Complete   — the digital, print and phone versions in one quiet
 *                   composition.
 *
 * 3. A landing hero composition showing several products at once, with one
 *    dominant piece — not four equal thumbnails (§6).
 *
 * Until these exist the UI falls back gracefully to generated artwork; it
 * never renders a broken image or a stock photo.
 * ------------------------------------------------------------------- */
