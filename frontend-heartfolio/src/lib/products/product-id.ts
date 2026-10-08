import type { ProductEntry } from "./types";

/**
 * ---------------------------------------------------------------------
 * THE ONE PLACE THE PUBLIC SLUG BECOMES THE BACKEND IDENTIFIER
 * ---------------------------------------------------------------------
 * Heartfolio publishes Where We Met at `/products/where-we-met`, but the
 * product's identity in the Django catalog, in `product_modules/registry.ts`
 * and in the backend's renderer registry is `"heart-map"` — see the comment
 * on that entry in `registry.ts` for why the id deliberately never changed
 * when the public slug did.
 *
 * `ProductEntry.id` already carries that stable identity, so no mapping
 * table is needed here: the rule is simply "URLs and marketing use `slug`,
 * anything crossing into the Studio module registry or the Django API uses
 * `id`". This function exists so that rule has exactly one enforcement
 * point and greps as one symbol, rather than `product.id` appearing at a
 * dozen call sites where a future reader can't tell whether `slug` would
 * have worked just as well.
 *
 * Applies to: product module lookup, `POST /projects/ {productId}`,
 * `POST /orders/ {productId}`, and `GET /products/<slug>/`.
 */
export function toBackendProductId(product: ProductEntry): string {
  return product.id;
}
