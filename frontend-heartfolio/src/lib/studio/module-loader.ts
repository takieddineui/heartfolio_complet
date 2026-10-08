import type { ProductEntry } from "@/lib/products/types";
import { getStartingPrice } from "@/lib/products/registry";
import { toBackendProductId } from "@/lib/products/product-id";
import type { ResolvedProductModuleConfig } from "@/types/studio";
import { getProductModuleLoader } from "./product-modules/registry";
import { assertModuleIntegrity } from "./module-integrity";

/**
 * Resolves a product's `ResolvedProductModuleConfig`. Products with a
 * real, extracted Product Module (see `product-modules/registry.ts`) get
 * their actual schema/theme/renderer/pricing/delivery/initial-state;
 * every other product still gets the original empty mock. `productId` is
 * attached here — once, centrally — from the `ProductEntry` this
 * function already received, rather than each module hand-authoring its
 * own copy (the exact duplication the architecture review flagged).
 *
 * INTEGRATION NOTE: the lookup key is the product's stable `id`, not its
 * public `slug`. Before the merge, the standalone Studio's own registry
 * had them identical (`heart-map`/`heart-map`); the Marketing App — now
 * the single Product Registry — publishes that same product under the
 * slug `where-we-met` while keeping `id: "heart-map"`. The module
 * registry and the Django catalog are both keyed by the id, so that is
 * what resolves here. See `lib/products/product-id.ts`.
 */
export async function loadProductModule(product: ProductEntry): Promise<ResolvedProductModuleConfig> {
  const productId = toBackendProductId(product);
  const loader = getProductModuleLoader(productId);
  const moduleConfig = loader ? await loader() : defaultMockModule(product);
  const resolved: ResolvedProductModuleConfig = { ...moduleConfig, productId };

  assertModuleIntegrity(productId, resolved);

  return resolved;
}

function defaultMockModule(product: ProductEntry) {
  return {
    formSchema: { sections: [] },
    themes: { axes: [] },
    renderer: { kind: "unset" as const },
    pricing: { currency: "USD", basePriceCents: startingPriceCents(product), rules: [] },
    delivery: { mode: "export" as const, export: { targets: {} } },
    messages: {},
    createInitialState: () => ({}),
    createInitialThemeSelections: () => ({}),
  };
}

/**
 * The unified `ProductEntry` carries `offerings[]` with numeric prices
 * rather than the standalone Studio registry's pre-formatted
 * `startingPrice: "$12"` string, so the old string-parsing step is gone.
 * Same resulting value, one less lossy conversion.
 */
function startingPriceCents(product: ProductEntry): number {
  const starting = getStartingPrice(product);
  return starting === null ? 0 : Math.round(starting * 100);
}
