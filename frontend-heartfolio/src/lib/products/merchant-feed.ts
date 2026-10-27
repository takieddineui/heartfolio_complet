import "server-only";

import type { ApiDeliveryPack } from "@/lib/api/products";
import type { CatalogProduct } from "@/lib/products/catalog";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { getProductCaptures } from "@/lib/captures/manifest";

/**
 * ---------------------------------------------------------------------
 * GOOGLE MERCHANT CENTER PRODUCT FEED (§16e)
 * ---------------------------------------------------------------------
 * Separate from the on-page `Product` JSON-LD by design: Merchant Center
 * consumes its own feed format and does not read structured data.
 *
 * ONE ITEM PER PACK, NOT PER PRODUCT, and built DIRECTLY from Django's own
 * `deliveryPacks` — deliberately NOT from `CatalogProduct.offerings`
 * (catalog.ts's `packToOffering`/`getAvailableOfferings`) or from
 * `getProductPageOfferings` (catalog.ts's product-page-only grouping, which
 * folds the wallpaper-combo packs into an add-on price delta rather than a
 * standalone sellable item — exactly wrong for a feed that needs one item
 * per SKU at a price a shopper can actually pay for that listing).
 * `PACK_SLUG_TO_FEED_OFFERING_KEY` below is this file's OWN, independent
 * mapping for exactly that reason.
 *
 * THE STANDALONE `wallpaper` PACK IS DELIBERATELY EXCLUDED FROM THE FEED,
 * even though it is still `status: active` and still purchasable directly
 * (Song Poster's, in particular — see `seed_catalog.py`'s own comment on
 * that pack for why it hasn't been disabled). Its Django status is
 * untouched by this file; this is the same "hidden from discovery, not
 * disabled" treatment already applied to the product page's own "Available
 * versions" section, now applied consistently to this second discovery
 * surface too. `PACK_SLUG_TO_FEED_OFFERING_KEY` simply has no entry for it,
 * so it is skipped the same way any future unmapped pack would be.
 *
 * Merchant Center's rule is that an item's `price` must match the price a
 * shopper sees on the `link` it points to. Love Story Timeline has five
 * separately purchasable packs (Song Poster has six, one of them excluded
 * per the paragraph above) at different prices, so a single item carrying
 * the "from" figure would mismatch the landing page for the rest and be
 * disapproved. Each pack is therefore its own item, tied together by
 * `item_group_id` — which is exactly what that attribute is for.
 *
 * HIDDEN PRODUCTS CANNOT REACH THIS. The feed is built from whatever the
 * caller passes in, and every catalog path already filters `hidden` (§14).
 * The test suite asserts the absence rather than trusting that.
 *
 * ⚠️ KNOWN RISK — landing-page price match, for the wallpaper-combo items.
 * `digital-plus-wallpaper` and `printable-plus-wallpaper` are now their own
 * feed items, each pointing at the same product page as every other pack of
 * that product. The page shows their combo price only as a "+{price}"
 * add-on line under Digital/Printable's own card (see
 * `getProductPageOfferings` in catalog.ts), never as a standalone price the
 * way this feed item's own `price` states it. The same landing-page
 * price-match risk this file already flagged for the original four items
 * applies here too, and the same fix would apply: a per-pack landing URL
 * (e.g. a `?pack=` parameter the product page reads and leads with), not a
 * change to the numbers here — the prices in this feed are Django's and are
 * correct.
 *
 * `image_link` IS THE PRODUCT ITSELF (26 Oct 2026): each product's capture
 * still (`lib/captures`), its real live page with a fictional sample, in the
 * feed's language, with no promotional text, logo or watermark added. It used
 * to be the branded share card ("HEARTFOLIO COLLECTION", marketing copy),
 * which Merchant Center's image policy rejects. One residual risk, stated:
 * the live pages' own "Made with Heartfolio" line, small and part of the
 * product, is visible in Song Poster's still; whether review treats that as
 * branding is Google's call. The share card stays the fallback only for a
 * product with no capture, which `captures.test.ts` rules out for every
 * visible one.
 */

export interface MerchantFeedItem {
  id: string;
  itemGroupId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  availability: "in_stock" | "out_of_stock";
  price: string;
  brand: string;
  condition: "new";
  productType: string;
  /** No GTIN or MPN exists for a made-to-order digital keepsake. */
  identifierExists: false;
}

export interface FeedProductCopy {
  /** `Products.<i18nKey>.name` */
  name: string;
  /** `Products.<i18nKey>.shortDescription` */
  shortDescription: string;
  /** `Products.offerings.<key>.name` */
  offeringName: (offeringKey: string) => string;
}

/**
 * This file's own pack-slug -> generic offering copy key mapping.
 *
 * Deliberately NOT imported from catalog.ts's `PACK_SLUG_TO_OFFERING` (that
 * map is product-page-card presentation and stays untouched by this file —
 * see the header comment above). The four original entries resolve to the
 * SAME `Products.offerings.<key>.name` strings the product page already
 * uses; `digital_plus_wallpaper`/`printable_plus_wallpaper` are two new
 * entries added to that same generic dictionary (not invented copy — reused
 * verbatim from Love Story Timeline's own Studio module pack names, already
 * shipped and translated). The standalone `wallpaper` slug has NO entry
 * here on purpose — see the header comment's "DELIBERATELY EXCLUDED"
 * paragraph.
 */
const PACK_SLUG_TO_FEED_OFFERING_KEY: Record<string, string> = {
  printable: "printable",
  live: "digital",
  "printable-plus-digital": "printable_plus_digital",
  complete: "complete_pack",
  "digital-plus-wallpaper": "digital_plus_wallpaper",
  "printable-plus-wallpaper": "printable_plus_wallpaper",
};

/**
 * Builds the feed items for one locale.
 *
 * `products` MUST be detail-hydrated — i.e. each one passed through
 * `getCatalogProductDetail`, not just `getCatalogProducts`. The list
 * response carries no delivery packs, so a list-only product's
 * `deliveryPacks` is empty and contributes nothing. The route does the
 * hydration; the emptiness is asserted in the tests so this cannot regress
 * quietly.
 *
 * Copy is passed in rather than read here so this stays a pure function with
 * no next-intl dependency — the route owns translation, this owns the
 * Merchant Center shape.
 */
export function buildMerchantFeedItems(
  products: CatalogProduct[],
  locale: string,
  copy: (product: CatalogProduct) => FeedProductCopy
): MerchantFeedItem[] {
  const items: MerchantFeedItem[] = [];

  for (const product of products) {
    // Only genuinely purchasable products belong in a shopping feed. A
    // product Django has disabled, or one with no live backend row, would
    // send a shopper to a page they cannot buy from.
    if (!product.isLive || product.status !== "available") continue;

    const text = copy(product);
    const link = `${SITE_URL}/${locale}/products/${product.slug}`;
    const still = getProductCaptures(product.id, locale)?.poster?.jpg.src;
    const imageLink = still ? `${SITE_URL}${still}` : `${link}/opengraph-image/card`;

    for (const pack of product.deliveryPacks) {
      if (pack.status !== "active") continue;

      const offeringKey = PACK_SLUG_TO_FEED_OFFERING_KEY[pack.slug];
      // No entry: either the standalone `wallpaper` pack (deliberately
      // excluded, see header comment) or a future pack this file has not
      // been taught about yet. Either way, omitted rather than guessed at —
      // the same "flag, don't invent" rule `unmappedPackSlugs` applies on
      // the product-page side of catalog.ts.
      if (!offeringKey) continue;

      items.push(feedItem(product, pack, offeringKey, text, link, imageLink));
    }
  }

  return items;
}

function feedItem(
  product: CatalogProduct,
  pack: ApiDeliveryPack,
  offeringKey: string,
  text: FeedProductCopy,
  link: string,
  imageLink: string
): MerchantFeedItem {
  return {
    id: `${product.slug}--${pack.slug}`,
    itemGroupId: product.slug,
    title: `${text.name} — ${text.offeringName(offeringKey)}`,
    description: text.shortDescription,
    link,
    imageLink,
    availability: "in_stock",
    // Merchant Center wants "12.00 USD", not the brand's "$12 USD". Computed
    // from the pack's own cents, same as everywhere else prices are shown.
    price: `${(pack.priceCents / 100).toFixed(2)} ${pack.currency}`,
    brand: SITE_NAME,
    condition: "new",
    productType: "Personalized digital keepsake",
    identifierExists: false,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * RSS 2.0 with Google's `g:` namespace — the format Merchant Center accepts
 * for a scheduled URL fetch, and the one that needs no account-side upload
 * step.
 *
 * Every value is escaped. Product copy is translator-authored rather than
 * customer-supplied, so this is not the primary defence against injection,
 * but an unescaped `&` in French or Arabic copy would silently produce
 * malformed XML and a rejected feed.
 */
export function renderMerchantFeed(items: MerchantFeedItem[], locale: string): string {
  const entries = items
    .map(
      (item) => `    <item>
      <g:id>${escapeXml(item.id)}</g:id>
      <g:item_group_id>${escapeXml(item.itemGroupId)}</g:item_group_id>
      <g:title>${escapeXml(item.title)}</g:title>
      <g:description>${escapeXml(item.description)}</g:description>
      <g:link>${escapeXml(item.link)}</g:link>
      <g:image_link>${escapeXml(item.imageLink)}</g:image_link>
      <g:availability>${item.availability}</g:availability>
      <g:price>${escapeXml(item.price)}</g:price>
      <g:brand>${escapeXml(item.brand)}</g:brand>
      <g:condition>${item.condition}</g:condition>
      <g:product_type>${escapeXml(item.productType)}</g:product_type>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(`${SITE_URL}/${locale}`)}</link>
    <description>${escapeXml("Personalized digital keepsakes, delivered instantly.")}</description>
${entries}
  </channel>
</rss>
`;
}
