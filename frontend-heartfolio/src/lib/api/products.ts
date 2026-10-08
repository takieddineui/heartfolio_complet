/**
 * The Django product catalog — the source of truth for everything
 * commercial: which products are actually purchasable, what a delivery pack
 * costs, and which delivery targets a purchase grants.
 *
 * The frontend Product Registry (`lib/products/registry.ts`) deliberately
 * keeps owning the *presentational* half — public slug, artwork, icon,
 * i18n keys, ordering, tags, FAQ count — because none of that exists in the
 * approved 8-table schema and none of it belongs there. The two are joined
 * in `lib/products/catalog.ts`; this module only speaks HTTP.
 */

import { apiFetch } from "./client";

/** Mirrors `apps/products/serializers.py::ProductSerializer` exactly. */
export interface ApiProduct {
  id: string;
  /** The Django/database slug — `heart-map`, never the public `where-we-met`. */
  slug: string;
  i18nKey: string;
  category: string;
  status: "available" | "waitlist" | "coming_soon" | "disabled";
  startingPriceCents: number;
  order: number;
  tags: string[];
}

/** Mirrors `apps/products/serializers.py::DeliveryPackSerializer` exactly. */
export interface ApiDeliveryPack {
  id: string;
  /** Django product slug this pack belongs to. */
  productId: string;
  /** `printable` | `wallpaper` | `live` | `complete` — see the catalog sheet. */
  slug: string;
  /** Translation keys resolved against the *product module's* own message
   * dictionary (`packs.printable.name`), not the app-wide next-intl
   * messages. That indirection is the backend's existing contract. */
  nameKey: string;
  descriptionKey: string;
  priceCents: number;
  currency: string;
  /** Export target ids this pack grants, or `__live__` for the hosted
   * digital deliverable. Authoritative — the frontend never derives it. */
  includedTargets: string[];
  status: "active" | "disabled";
}

export interface ApiProductDetail {
  product: ApiProduct;
  deliveryPacks: ApiDeliveryPack[];
  /** §7d — dashboard-managed sizes. Absent from an older backend, in which
   *  case the product page falls back to the static definitions. */
  printSizes?: ApiPrintSize[];
  /** §7c — published reviews for this product. */
  reviews?: ApiReview[];
  ratingSummary?: ApiRatingSummary | null;
}

/**
 * Publicly listed products only. Django filters to `status="available"`, so
 * anything still on the waitlist (Star Map, Song Poster) simply isn't in
 * this response — and isn't expected to be. Those remain waitlist entries in
 * the frontend registry, which is why hydration merges rather than replaces.
 */
export interface ApiOccasion {
  key: string;
  tags: string[];
  order: number;
}

export interface ApiPrintSize {
  key: string;
  baseWidthPx: number;
  baseHeightPx: number;
  order: number;
}

export interface ApiReview {
  id: string;
  rating: number | null;
  message: string;
  displayName: string;
  createdAt: string;
}

export interface ApiRatingSummary {
  average: number;
  count: number;
}

export interface ApiCatalogResponse {
  products: ApiProduct[];
  occasions: ApiOccasion[];
  printSizes: ApiPrintSize[];
  /** §7c — published reviews. Absent from an older backend. */
  reviews?: ApiReview[];
  /** Null when nothing is published — callers must omit the aggregate
   *  markup rather than render a zero. */
  ratingSummary?: ApiRatingSummary | null;
}

export async function fetchProducts(signal?: AbortSignal): Promise<ApiCatalogResponse> {
  /**
   * §7d — accepts BOTH response shapes on purpose.
   *
   * `GET /products/` used to return a bare array and now returns an object
   * carrying the editable occasions and print sizes alongside. The frontend
   * and backend deploy independently (separate hosts, Vercel and Railway, when this was
   * written; still separate images), so for a few
   * minutes after any release one is ahead of the other — and a storefront
   * that returns no products during that window is a real outage, not a
   * cosmetic one.
   *
   * Reading both shapes makes the change deployable in either order. When
   * the old shape arrives, there is no taxonomy to report and callers fall
   * back to the static definitions, exactly as they do when Django is
   * unreachable entirely.
   *
   * This tolerance can be deleted once both sides have been live together
   * long enough that no old build can still be serving.
   */
  const raw = await apiFetch<ApiProduct[] | ApiCatalogResponse>("/products", {
    method: "GET",
    signal,
  });

  if (Array.isArray(raw)) {
    return { products: raw, occasions: [], printSizes: [] };
  }
  return {
    products: raw.products ?? [],
    occasions: raw.occasions ?? [],
    printSizes: raw.printSizes ?? [],
  };
}

/**
 * A single product plus its active delivery packs.
 *
 * `backendProductId` must be the Django slug (`heart-map`), never the public
 * URL slug (`where-we-met`) — use `toBackendProductId()` at the boundary.
 * A product that isn't `available` returns 404 by design: the catalog
 * endpoint refuses to leak the existence of unlisted products.
 */
export async function fetchProductDetail(
  backendProductId: string,
  signal?: AbortSignal
): Promise<ApiProductDetail> {
  return apiFetch<ApiProductDetail>(`/products/${backendProductId}`, { method: "GET", signal });
}
