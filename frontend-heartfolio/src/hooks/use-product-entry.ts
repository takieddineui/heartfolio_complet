import { getProductById, getProductBySlug } from "@/lib/products/registry";
import type { ProductEntry } from "@/lib/products/types";

/**
 * Locates the selected product in the Product Registry. Synchronous today
 * because the registry is a static in-memory array — kept as its own
 * function (rather than inlined) so swapping the registry for the shared
 * package or API described in STUDIO_INTEGRATION_GUIDE.md §3 only touches
 * this one call site, and so it can become async without changing callers.
 */
export function resolveProductEntry(productSlugOrId: string): ProductEntry | undefined {
  // Public slug first (how /studio/:slug arrives), then stable id (how a
  // project loaded from Django arrives — it stores `heart-map`, not
  // `where-we-met`). The parameter has always been named `productSlugOrId`;
  // until projects were real, only the slug half was ever exercised.
  return getProductBySlug(productSlugOrId) ?? getProductById(productSlugOrId);
}
