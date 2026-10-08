/**
 * ---------------------------------------------------------------------
 * SERVER-SIDE CATALOG FETCHING (SSR)
 * ---------------------------------------------------------------------
 * Product pages render per request so prices are never baked into a
 * build. This module is the only place the server reads the Django catalog.
 *
 * WHY IT CALLS THE BACKEND ORIGIN DIRECTLY, not `/api/backend/*`: the proxy
 * rewrite exists to keep the *browser's* session cookie first-party. Server
 * code has no origin to be same-site with, and a relative URL has nothing to
 * resolve against. The catalog is public (`AllowAny`, no session), so there
 * is no cookie to forward and nothing is weakened by going direct.
 *
 * FALLBACK — two failures that look alike and must not be treated alike:
 *
 *   Django unreachable / 5xx / timeout  -> transient. Serve the last catalog
 *                                          that worked, so a blip doesn't
 *                                          empty the storefront.
 *   Django answers 200 with []          -> NOT transient. That is a real,
 *                                          deliberate answer: the catalog was
 *                                          emptied, or a product was pulled.
 *                                          Serving a cached copy here would
 *                                          keep selling something someone
 *                                          intentionally withdrew. The empty
 *                                          answer is passed through, loudly.
 *
 * The cache is a module-level variable — no Redis, no KV, no new infra, per
 * the "keep it simple" instruction. Honest limitation: it lives per server
 * instance and does not survive a cold start, so a cold instance hitting an
 * unreachable Django has nothing to fall back to and says so via
 * `source: "unavailable"` rather than inventing prices. Callers decide how to
 * present that; nothing here fabricates commercial data.
 */

import "server-only";

import type {
  ApiCatalogResponse,
  ApiRatingSummary,
  ApiReview,
  ApiDeliveryPack,
  ApiOccasion,
  ApiPrintSize,
  ApiProduct,
  ApiProductDetail,
} from "@/lib/api/products";
import type { ProductEntry } from "./types";
import { getBackendOrigin } from "../backend-origin";
import { toBackendProductId } from "./product-id";
import { mergeProductList, toCatalogProduct, toRegistryOnlyProduct, type CatalogProduct } from "./catalog";

/** How the commercial data in a response was obtained. Callers use this to
 * decide what, if anything, to tell the customer — never to decide a price. */
export type CatalogSource =
  | "live" // Django answered; this is current truth (including a legitimate empty answer)
  | "cache" // Django was unreachable; serving the last catalog that worked
  | "unavailable"; // Django was unreachable and nothing has ever succeeded here

export interface CatalogListResult {
  products: CatalogProduct[];
  /** §7d — dashboard-managed occasions and sizes. Empty when Django is
   *  unreachable or still serving the old response shape; callers fall back
   *  to the static definitions rather than showing nothing. */
  taxonomy: CatalogTaxonomy;
  source: CatalogSource;
  /** True when Django explicitly returned an empty catalog. Distinct from a
   * failure: it means nothing is for sale right now, on purpose. */
  isEmptyCatalog: boolean;
}

export interface CatalogDetailResult {
  /** §7d — managed print sizes for this product's page. Empty when Django
   *  is unreachable or predates the field; the page falls back to the
   *  static list rather than showing no sizes at all. */
  printSizes?: ApiPrintSize[];
  /** §7c — published reviews for this product, and their aggregate. The
   *  summary is null when nothing is published, which callers must treat as
   *  "omit the markup" rather than "render a zero". */
  reviews?: ApiReview[];
  ratingSummary?: ApiRatingSummary | null;
  product: CatalogProduct;
  source: CatalogSource;
}

let cachedProductList: ApiProduct[] | null = null;

/**
 * §7d — managed occasions and print sizes, cached alongside the products for
 * the same reason: an outage must not empty the storefront's taxonomy any
 * more than it empties its catalog.
 */
export interface CatalogTaxonomy {
  occasions: ApiOccasion[];
  printSizes: ApiPrintSize[];
  /** §7c — published reviews across all products, for the homepage. */
  reviews: ApiReview[];
  ratingSummary: ApiRatingSummary | null;
}

/** Empty means "Django told us nothing", which callers read as "use the
 *  static definitions" — never as "there are no occasions". */
const EMPTY_TAXONOMY: CatalogTaxonomy = {
  occasions: [],
  printSizes: [],
  reviews: [],
  ratingSummary: null,
};

let cachedTaxonomy: CatalogTaxonomy | null = null;
const cachedDetails = new Map<string, ApiProductDetail>();

const REQUEST_TIMEOUT_MS = 8000;

async function fetchFromBackend<T>(origin: string, path: string): Promise<T> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    headers: { Accept: "application/json" },
    // SSR: never serve a price from Next's data cache.
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Heartfolio catalog request failed: ${path} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * The full storefront list: Django's commercial data merged over the
 * registry's presentation data. Registry-only products (Star Map, Song
 * Poster) are always present and always untouched — they have no Django
 * rows, so an empty or failed catalog response says nothing about them.
 */
export async function getCatalogProducts(): Promise<CatalogListResult> {
  // Resolved OUTSIDE the try, on purpose. Everything inside it is treated as
  // "Django is unreachable" and degrades to a cached or registry-only
  // storefront. A missing BACKEND_API_ORIGIN is a configuration error, not an
  // outage, and must not be dressed up as one — it throws.
  const origin = getBackendOrigin();

  try {
    /**
     * §7d — the response now carries the editable occasions and print sizes
     * alongside the products, so the storefront reads managed data without
     * a second request on every render.
     *
     * BOTH SHAPES ARE ACCEPTED. This endpoint used to return a bare array.
     * The frontend and backend deploy independently (Vercel and Railway, when
     * this was written), so one is always briefly ahead of the other, and a storefront returning no products during
     * that window is a real outage. An old-shaped response simply carries
     * no taxonomy and callers fall back to the static definitions —
     * the same fallback used when Django is unreachable entirely.
     */
    const raw = await fetchFromBackend<ApiProduct[] | ApiCatalogResponse>(origin, "/products/");
    const apiProducts = Array.isArray(raw) ? raw : raw.products ?? [];
    const taxonomy: CatalogTaxonomy = Array.isArray(raw)
      ? EMPTY_TAXONOMY
      : {
          occasions: raw.occasions ?? [],
          printSizes: raw.printSizes ?? [],
          reviews: raw.reviews ?? [],
          ratingSummary: raw.ratingSummary ?? null,
        };

    cachedProductList = apiProducts;
    cachedTaxonomy = taxonomy;

    if (apiProducts.length === 0) {
      // Deliberate, not a blip — do not paper over it with the cache.
      console.warn("[catalog] Django returned an empty product catalog; nothing is currently purchasable.");
      return { products: mergeProductList([]), taxonomy, source: "live", isEmptyCatalog: true };
    }

    return { products: mergeProductList(apiProducts), taxonomy, source: "live", isEmptyCatalog: false };
  } catch (error) {
    console.error("[catalog] Product list request failed:", error);

    if (cachedProductList) {
      return {
        products: mergeProductList(cachedProductList),
        taxonomy: cachedTaxonomy ?? EMPTY_TAXONOMY,
        source: "cache",
        isEmptyCatalog: false,
      };
    }
    // Nothing has ever succeeded on this instance. Presentation data only —
    // no prices, no invented availability.
    return {
      products: mergeProductList([]),
      taxonomy: EMPTY_TAXONOMY,
      source: "unavailable",
      isEmptyCatalog: false,
    };
  }
}

/**
 * One product's commercial detail, including its delivery packs.
 *
 * `entry` is the registry entry (public slug); the request uses the Django
 * slug via `toBackendProductId`. A 404 here is meaningful rather than
 * exceptional — Django returns it for any product that isn't `available`,
 * deliberately refusing to leak unlisted products — so it is treated as
 * "not purchasable", not as a transient failure, and the cache is not used.
 */
export async function getCatalogProductDetail(entry: ProductEntry): Promise<CatalogDetailResult> {
  const backendId = toBackendProductId(entry);
  // Outside the try for the same reason as in `getCatalogProducts`.
  const origin = getBackendOrigin();

  try {
    const detail = await fetchFromBackend<ApiProductDetail>(origin, `/products/${backendId}/`);
    cachedDetails.set(backendId, detail);
    return {
      product: toCatalogProduct(entry, detail),
      printSizes: detail.printSizes,
      reviews: detail.reviews,
      ratingSummary: detail.ratingSummary,
      source: "live",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("-> 404")) {
      // Real answer: this product is not on sale. Registry presentation
      // stands; nothing commercial is claimed.
      return { product: toRegistryOnlyProduct(entry), source: "live" };
    }

    console.error(`[catalog] Detail request failed for ${backendId}:`, error);

    const cached = cachedDetails.get(backendId);
    if (cached) {
      return { product: toCatalogProduct(entry, cached), printSizes: cached.printSizes, source: "cache" };
    }
    return { product: toRegistryOnlyProduct(entry), source: "unavailable" };
  }
}

/** Test seam only — resets the module-level cache between cases. */
export function __resetCatalogCacheForTests(): void {
  cachedProductList = null;
  cachedDetails.clear();
}

export type { ApiDeliveryPack };
