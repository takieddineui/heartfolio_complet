"use client";

import { useLocale } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getAllProducts, getProductById } from "@/lib/products/registry";
import { resolveShellText } from "@/lib/studio/i18n";
import { useProductContent } from "@/lib/products/use-product-content";
import type { ProductEntry } from "@/lib/products/types";

/**
 * ---------------------------------------------------------------------
 * "OTHER PRODUCTS" ON THE THANK-YOU PAGE (§10) — AND WHY IT IS USUALLY
 * INVISIBLE RIGHT NOW
 * ---------------------------------------------------------------------
 * §10 asks for other products below the confirmation so a happy customer
 * can keep browsing. That was written when four products existed. §1
 * withdrew three of them, so today there is exactly one — and the only
 * other product is the one they just bought.
 *
 * So this renders nothing at all in the current catalog. That is the
 * correct outcome, not a bug to work around: a "you might also like"
 * heading above an empty space, or above the item already in their hands,
 * is worse than no section. The component exists and is wired in so that
 * restoring or adding a product brings the strip back with no further work.
 *
 * `getAllProducts()` already excludes hidden products (§14), so a withdrawn
 * product can never surface here — the same guarantee that holds on the
 * homepage, the collection page and the sitemap, for the same reason.
 *
 * The purchased product is excluded by its Django id rather than its slug,
 * because that is what an order records and the two differ for some
 * products (`heart-map` vs `where-we-met`). Matching on slug would have
 * silently failed to exclude exactly those.
 */
export function OtherProducts({ purchasedProductId }: { purchasedProductId: string }) {
  const locale = useLocale();
  const st = (key: string) => resolveShellText(key, locale);

  const purchased = getProductById(purchasedProductId);
  const others = getAllProducts().filter(
    (product) => product.id !== purchased?.id && product.id !== purchasedProductId
  );

  if (others.length === 0) return null;

  return (
    <div className="pt-4 text-start">
      <h3 className="font-serif text-xl text-heading">{st("otherProducts.title")}</h3>
      <ul className="mt-4 space-y-2">
        {others.map((product) => (
          <li key={product.id}>
            <OtherProductLink product={product} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OtherProductLink({ product }: { product: ProductEntry }) {
  const { name, shortDescription } = useProductContent(product);

  return (
    <Link
      href={`/products/${product.slug}`}
      className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-subtle bg-card p-4 transition-colors hover:border-champagne-gold"
    >
      <span>
        <span className="block font-medium text-heading">{name}</span>
        <span className="mt-0.5 block text-sm text-body/60">{shortDescription}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-champagne-gold" strokeWidth={2} />
    </Link>
  );
}
