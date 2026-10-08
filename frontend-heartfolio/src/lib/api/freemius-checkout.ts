/**
 * Freemius checkout staging (sandbox review build). Mirrors `orders.ts`'s
 * own shape and the same "browser never sends a price" discipline — see
 * that file's header comment — but talks to a genuinely separate set of
 * endpoints, since no `Order` exists until one of these completes (see
 * the backend's `apps/commerce/services.py` module comment on why
 * Freemius can't reuse `create_order`/`payOrder`).
 */

import { apiFetch } from "./client";
import type { ApiOrder } from "./orders";

export type FreemiusStagingStatus = "awaiting_payment" | "completed" | "expired" | "failed";

/** Mirrors `apps/commerce/serializers.py::FreemiusStagingSerializer`. */
export interface ApiFreemiusStaging {
  stagingId: string;
  productId: string;
  deliveryPackId: string;
  currency: string;
  expectedTotalCents: number;
  status: FreemiusStagingStatus;
  orderId: string | null;
  freemiusProductId: string;
  /** Not secret — passed straight into `FS.Checkout({ public_key, ... })`. */
  publicKey: string;
  planId: string | null;
  pricingId: string | null;
  sandbox: { token: string; ctx: string } | null;
}

export async function stageFreemiusCheckout(
  productId: string,
  deliveryPackId: string,
  projectId: string,
  locale: string,
  signal?: AbortSignal
): Promise<ApiFreemiusStaging> {
  return apiFetch<ApiFreemiusStaging>("/checkout/freemius/stage", {
    method: "POST",
    body: { productId, deliveryPackId, projectId, locale },
    signal,
  });
}

export async function getFreemiusStaging(stagingId: string, signal?: AbortSignal): Promise<ApiFreemiusStaging> {
  return apiFetch<ApiFreemiusStaging>(`/checkout/freemius/stage/${stagingId}`, { method: "GET", signal });
}

/**
 * Called right after the checkout overlay's own `purchaseCompleted`
 * callback hands back a `license_id`. That callback is a lookup key,
 * not proof — this is the server-side verification that makes it
 * trustworthy (re-fetches the license from Freemius's own API,
 * cross-checks the plan). Returns the real `Order`, created for the
 * first time by this exact call (or an already-existing one, if this is
 * a retried/duplicate call — see the backend's own idempotency).
 */
export async function completeFreemiusCheckout(
  stagingId: string,
  licenseId: string,
  signal?: AbortSignal
): Promise<ApiOrder> {
  return apiFetch<ApiOrder>("/checkout/freemius/complete", {
    method: "POST",
    body: { stagingId, licenseId },
    signal,
  });
}
