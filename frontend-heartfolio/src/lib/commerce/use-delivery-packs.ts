"use client";

import { useEffect, useState } from "react";
import { fetchProductDetail } from "@/lib/api/products";
import type { DeliveryPack } from "@/types/commerce";

/**
 * The product's delivery packs, from Django.
 *
 * Replaces `lib/commerce/delivery-pack-registry.ts`, which hardcoded packs
 * and prices in the frontend. Prices, pack existence and included targets
 * are commercial data the backend owns; nothing here invents any of it.
 *
 * The returned `id` is the pack's Django slug, because that is what
 * `POST /orders/ {deliveryPackId}` expects — the backend resolves it scoped
 * to the product, so a pack from another product cannot be ordered.
 *
 * `null` means "still loading"; `[]` means the product genuinely has no
 * purchasable packs, which the existing UI already renders as
 * `checkout.noPacks`.
 */
export function useDeliveryPacks(backendProductId: string): {
  packs: DeliveryPack[] | null;
  error: boolean;
} {
  /**
   * §17 — the loading state is DERIVED from the product id, not set.
   *
   * This used to call `setPacks(null)` and `setError(false)` synchronously
   * at the top of the effect to reset when the product changed. React's
   * `set-state-in-effect` rule flags that, and here the consequence was
   * concrete: for one render after switching product, the checkout showed
   * the PREVIOUS product's packs and prices as though they were current.
   * A customer clicking through fast enough could see a price that does not
   * belong to what they are buying.
   *
   * Keeping the resolved packs alongside the id they were fetched for means
   * a mismatch simply reads as "still loading" — no reset, no extra render,
   * and no frame in which the wrong prices are on screen.
   */
  const [resolved, setResolved] = useState<{
    id: string;
    packs: DeliveryPack[];
    error: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchProductDetail(backendProductId)
      .then((detail) => {
        if (cancelled) return;
        setResolved({
          id: backendProductId,
          error: false,
          packs: detail.deliveryPacks
            .filter((pack) => pack.status === "active")
            .map((pack) => ({
              // The slug, not the UUID — see the note above.
              id: pack.slug,
              productId: detail.product.slug,
              nameKey: pack.nameKey,
              descriptionKey: pack.descriptionKey,
              priceCents: pack.priceCents,
              currency: pack.currency,
              includedTargets: pack.includedTargets,
            })),
        });
      })
      .catch(() => {
        if (cancelled) return;
        // No fallback catalog: showing invented prices would be worse than
        // showing none. The UI surfaces this as an error state.
        setResolved({ id: backendProductId, packs: [], error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [backendProductId]);

  // A mismatch means the product changed and the new fetch has not landed.
  const current = resolved?.id === backendProductId ? resolved : null;
  return { packs: current ? current.packs : null, error: current?.error ?? false };
}

/** Cheapest active pack, for the "from" price shown while editing. */
export function getStartingPackPrice(packs: DeliveryPack[] | null): DeliveryPack | null {
  if (!packs || packs.length === 0) return null;
  return packs.reduce((cheapest, pack) => (pack.priceCents < cheapest.priceCents ? pack : cheapest));
}
