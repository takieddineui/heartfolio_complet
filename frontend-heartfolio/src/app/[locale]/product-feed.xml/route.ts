import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getCatalogProducts, getCatalogProductDetail } from "@/lib/products/catalog-server";
import { buildMerchantFeedItems, renderMerchantFeed } from "@/lib/products/merchant-feed";

/**
 * ---------------------------------------------------------------------
 * `/<locale>/product-feed.xml` — Merchant Center scheduled fetch (§16e)
 * ---------------------------------------------------------------------
 * ONE FEED PER LOCALE. Merchant Center registers a feed against a single
 * (country, language, currency) combination, so a single mixed-language file
 * cannot serve all three. Prices are USD everywhere (§15), so the locales
 * differ only in copy — but they still need separate URLs to be registered
 * separately.
 *
 * NOT UNDER `/api/`, which robots.txt disallows. Google's feed fetcher
 * honours robots.txt on scheduled fetches, so putting the feed behind a
 * `Disallow` would break it silently — the account would simply report the
 * feed as unfetchable. It sits alongside the marketing routes instead, which
 * are crawlable by design (§16d).
 *
 * Rendered per request for the same reason as every other price surface: a
 * feed built at deploy time is a feed quoting whatever the catalog said
 * then, and Merchant Center disapproves items whose price disagrees with the
 * landing page.
 */
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;

  if (!(routing.locales as readonly string[]).includes(locale)) {
    return new Response("Not found", { status: 404 });
  }

  /**
   * Two calls, deliberately.
   *
   * `GET /products/` carries only `starting_price_cents` — no delivery packs —
   * so a feed built from the list alone has one price per product and no way
   * to emit the per-pack items Merchant Center requires. The first version of
   * this route did exactly that and produced an empty feed, because launch
   * products hold no static offerings in the registry either: the packs only
   * exist on the detail response.
   *
   * So the list decides *which* products are sellable, and one detail call
   * per survivor supplies their packs. That is one extra request per product
   * per feed fetch — cheap at today's catalog size, and Merchant Center polls
   * on a schedule rather than per visitor. If the catalog grows to where this
   * matters, the fix is a packs-inclusive list endpoint on Django, not a
   * cached approximation here.
   */
  const { products } = await getCatalogProducts();
  const sellable = products.filter((product) => product.isLive && product.status === "available");
  const detailed = await Promise.all(
    sellable.map(async (product) => (await getCatalogProductDetail(product)).product)
  );

  const tProducts = await getTranslations({ locale, namespace: "Products" });

  const items = buildMerchantFeedItems(detailed, locale, (product) => ({
    name: tProducts(`${product.i18nKey}.name`),
    shortDescription: tProducts(`${product.i18nKey}.shortDescription`),
    offeringName: (offeringKey: string) => tProducts(`offerings.${offeringKey}.name`),
  }));

  return new Response(renderMerchantFeed(items, locale), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Short shared cache: Merchant Center fetches on a schedule, and a
      // stale price here is a disapproved item rather than a cosmetic bug.
      "Cache-Control": "public, max-age=0, s-maxage=600",
    },
  });
}
