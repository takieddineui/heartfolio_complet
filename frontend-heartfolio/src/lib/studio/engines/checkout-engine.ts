/**
 * ---------------------------------------------------------------------
 * CHECKOUT ORCHESTRATION
 * ---------------------------------------------------------------------
 * The one place that knows the order of operations between the Studio and
 * Django. The UI calls these functions and renders their results; it does
 * not itself decide what must happen before what.
 *
 * THE SEQUENCE IS NOT ARBITRARY:
 *
 *   1. identify guest    every endpoint below needs a session customer
 *   2. upload photos     renderers read `photo.assetId`; a project saved
 *                        without it is unrenderable after payment
 *   3. save project      `LoveStoryTimelineRenderer.render()` raises when
 *                        `order.project` is null — an order created first
 *                        would take money for something undeliverable
 *   4. create order      server prices it from DeliveryPack.price_cents
 *   5. start payment     Paddle transaction, or an inline mock charge
 *
 * Each step is resumable: a retry after a failure re-uses the project and
 * order already created rather than duplicating them.
 */

import { identifyGuest } from "@/lib/api/guest";
import {
  createOrder,
  getOrder,
  payOrder,
  type ApiCheckoutHandle,
  type ApiOrder,
} from "@/lib/api/orders";
import {
  getFreemiusStaging,
  stageFreemiusCheckout,
  type ApiFreemiusStaging,
} from "@/lib/api/freemius-checkout";
import { projectEngine } from "@/lib/studio/extension-points";
import { uploadPendingMedia } from "@/lib/studio/media-values";

export interface CheckoutContext {
  /** Django product slug. */
  productId: string;
  /** Django delivery pack slug. */
  deliveryPackId: string;
  email: string;
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
  /** Set when the Studio was opened from a saved project. */
  projectId?: string;
  /** Site language at checkout — recorded on the order. See `createOrder`. */
  locale: string;
}

export interface PreparedCheckout {
  order: ApiOrder;
  projectId: string;
  /** The values with `assetId`s stamped in, so the Studio can adopt them
   * and a retry doesn't re-upload the same photos. */
  values: Record<string, unknown>;
}

/**
 * Steps 1–4. Returns a pending order priced by the server.
 *
 * `onProgress` exists so the existing UI can say which step is running
 * without this module knowing anything about the UI.
 */
export async function prepareOrder(
  context: CheckoutContext,
  onProgress?: (stage: "identifying" | "uploading" | "saving" | "ordering") => void,
  signal?: AbortSignal
): Promise<PreparedCheckout> {
  onProgress?.("identifying");
  await identifyGuest(context.email, signal);

  onProgress?.("uploading");
  const values = (await uploadPendingMedia(context.values, signal)) as Record<string, unknown>;

  onProgress?.("saving");
  const { projectId } = await projectEngine.save(context.projectId, {
    productId: context.productId,
    values,
    themeSelections: context.themeSelections,
  });

  onProgress?.("ordering");
  const order = await createOrder(
    context.productId,
    context.deliveryPackId,
    projectId,
    context.locale,
    signal
  );

  return { order, projectId, values };
}

/**
 * Step 5. Returns the Paddle handle when the backend is running Paddle, or
 * `null` when the configured provider settles inline (the mock provider used
 * in local development), in which case `order` already carries the final
 * state. The frontend never assumes which one it is — it reads the response.
 */
export async function startPayment(
  orderId: string,
  signal?: AbortSignal
): Promise<{ order: ApiOrder; checkout: ApiCheckoutHandle | null }> {
  const response = await payOrder(orderId, signal);
  return { order: response.order, checkout: response.checkout };
}

export type PaymentOutcome = "paid" | "pending" | "failed" | "cancelled";

/**
 * Polls Django until the order reaches a settled state.
 *
 * This exists because completing Paddle's overlay is NOT payment: the
 * browser learns the customer clicked "pay", while the money is confirmed
 * out-of-band by the signature-verified `transaction.paid` webhook. Only the
 * order status Django reports is trusted.
 *
 * Returns `"pending"` if the webhook hasn't arrived within the window. That
 * is not a failure — the payment may still land — so the caller must offer a
 * way back to the order rather than declaring it failed.
 */
export async function waitForPaidOrder(
  orderId: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}
): Promise<{ order: ApiOrder; outcome: PaymentOutcome }> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  let order = await getOrder(orderId, options.signal);

  while (order.status === "pending" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (options.signal?.aborted) break;
    order = await getOrder(orderId, options.signal);
  }

  return { order, outcome: order.status as PaymentOutcome };
}

// ------------------------------------------------------------------
// Freemius (sandbox review build) — staged checkout, no pre-existing Order
// ------------------------------------------------------------------
// Freemius's checkout has no passthrough field to resolve a webhook back
// to a pending order (see the backend's apps/commerce/services.py module
// comment), so no Order exists until a real payment is verified. This
// section is the Freemius-specific counterpart to prepareOrder/
// startPayment/waitForPaidOrder above — same steps 1-3 (identity, photo
// upload, project save), but stages instead of creating an Order, and
// the overlay's own callback (see freemius-client.ts's
// openFreemiusCheckout) is verified server-side via
// completeFreemiusCheckout rather than polling from the start.

export interface PreparedFreemiusStaging {
  staging: ApiFreemiusStaging;
  projectId: string;
  values: Record<string, unknown>;
}

/**
 * Steps 1-4 for Freemius. Returns a staged (not yet paid, not yet an
 * Order) checkout, priced and plan-mapped by the server.
 */
export async function prepareFreemiusStaging(
  context: CheckoutContext,
  onProgress?: (stage: "identifying" | "uploading" | "saving" | "ordering") => void,
  signal?: AbortSignal
): Promise<PreparedFreemiusStaging> {
  onProgress?.("identifying");
  await identifyGuest(context.email, signal);

  onProgress?.("uploading");
  const values = (await uploadPendingMedia(context.values, signal)) as Record<string, unknown>;

  onProgress?.("saving");
  const { projectId } = await projectEngine.save(context.projectId, {
    productId: context.productId,
    values,
    themeSelections: context.themeSelections,
  });

  onProgress?.("ordering");
  const staging = await stageFreemiusCheckout(context.productId, context.deliveryPackId, projectId, context.locale, signal);

  return { staging, projectId, values };
}

/**
 * The active-checkout-provider switch, frontend side — the counterpart to
 * the backend's `FREEMIUS_ENABLED`/`PAYMENT_PROVIDER` split (see
 * `config/settings/base.py`'s own comment on why Freemius is a separate,
 * independently-flippable flag rather than a new `PAYMENT_PROVIDER` value:
 * its checkout has no pre-existing Order to hang a `PaymentProvider`
 * subclass off of). `checkout-flow.tsx` reads this once, at the top of
 * `startCheckout`, to pick exactly one of the two flows below — never
 * both, and never a customer-visible third choice. Defaults to Paddle
 * (`false`) for the same reason `getPaddleEnvironment` defaults to
 * sandbox: a missing variable must never silently switch which provider
 * runs.
 */
export function isFreemiusCheckoutActive(): boolean {
  return process.env.NEXT_PUBLIC_FREEMIUS_ENABLED === "true";
}

export type FreemiusStagingOutcome = "completed" | "awaiting_payment" | "expired" | "failed";

/**
 * The fallback poll target for when the checkout overlay's own
 * `purchaseCompleted` callback never fires (closed early, or the
 * caller's own `completeFreemiusCheckout` call failed transiently) —
 * NOT needed on the happy path, where completion is verified directly
 * and immediately once the overlay reports success. Same shape as
 * `waitForPaidOrder` above (2s interval, degrades to a non-failure
 * outcome rather than an error if the window lapses), retargeted at the
 * staging resource: `orderId` is only meaningful once `status ===
 * "completed"`.
 */
export async function waitForStagedOrder(
  stagingId: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}
): Promise<{ staging: ApiFreemiusStaging; outcome: FreemiusStagingOutcome }> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  let staging = await getFreemiusStaging(stagingId, options.signal);

  while (staging.status === "awaiting_payment" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (options.signal?.aborted) break;
    staging = await getFreemiusStaging(stagingId, options.signal);
  }

  return { staging, outcome: staging.status };
}
