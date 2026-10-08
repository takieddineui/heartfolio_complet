import { getAllProducts } from "@/lib/products/registry";
import { enabledIntents } from "@/lib/products/gift-intents";
import { PRINT_SIZES } from "@/lib/studio/print-sizes";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";

/**
 * `/llms.txt` — a plain-text summary for AI crawlers (§16).
 *
 * GENERATED FROM THE CATALOG, NOT WRITTEN BY HAND. A hand-written file
 * would have listed four products when this work started and would still be
 * listing three withdrawn ones now. Building it from `getAllProducts()` and
 * `enabledIntents()` means it inherits §14's guarantee for free: a hidden
 * product cannot appear here any more than it can in the sitemap.
 *
 * Static, not dynamic. Everything here comes from the frontend registry
 * rather than Django, so there is nothing to fetch and no reason for this
 * route to be per-request — unlike every page that quotes a price.
 *
 * Deliberately factual and short. This file is read by something deciding
 * whether it can answer a question about Heartfolio; marketing adjectives
 * make it worse at that, not better.
 */
export const dynamic = "force-static";

export function GET() {
  const products = getAllProducts();
  const sizes = PRINT_SIZES.map((size) => size.id).join(", ");

  const body = `# ${SITE_NAME}

> Personalized digital keepsakes and printable gifts. A customer supplies
> their own dates, places, photos and words; ${SITE_NAME} turns them into
> artwork delivered as high-resolution files. Nothing is shipped.

## What it is
- Personalized digital gifts, bought mainly for anniversaries and weddings.
- Delivered instantly as downloads after payment — no shipping, no waiting.
- Prices are in USD. There is no subscription; each keepsake is bought once.
- Available in English, French and Arabic.

## What a customer receives
- Print-ready PNG and PDF files at 300 DPI.
- Print sizes: ${sizes} — each in two versions, one frameless for mounting
  under glass and one with a border for an ordinary picture frame.
- Phone, tablet and desktop wallpapers.
- Some packs include an interactive web version of the keepsake.

## Products
${products
  .map((product) => `- ${product.slug}: ${SITE_URL}/en/products/${product.slug}`)
  .join("\n")}

## Key pages
- Collection: ${SITE_URL}/en/products
${enabledIntents()
  .map((intent) => `- ${intent.slug}: ${SITE_URL}/en/gifts/${intent.slug}`)
  .join("\n")}
- Contact: ${SITE_URL}/en/contact
- Feedback: ${SITE_URL}/en/feedback
- Terms: ${SITE_URL}/en/terms
- Privacy: ${SITE_URL}/en/privacy
- Refunds: ${SITE_URL}/en/refunds

## Notes for crawlers
- The Studio, project, order and AR pages are private to a customer and are
  excluded in robots.txt. They hold session-scoped or purchased content and
  are not useful to index.
- Structured data (Organization, WebSite, FAQPage, Product, BreadcrumbList)
  is published on the pages above.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
