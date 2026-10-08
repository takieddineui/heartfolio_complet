/**
 * Orders, payment and entitlements.
 *
 * THE BROWSER NEVER SENDS A PRICE AND NEVER DECIDES A PAYMENT STATE.
 * `POST /orders/` accepts only `productId`, `deliveryPackId` and
 * `projectId`; the amount is computed server-side from
 * `DeliveryPack.price_cents`. There is no field through which a tampered
 * total could travel, and no endpoint that lets a client mark an order paid
 * — only the signature-verified Paddle webhook does that, after reconciling
 * the amount and currency against the order.
 *
 * Consequently the frontend treats `order.status === "paid"`, read back
 * from Django, as the single source of truth. Paddle.js reporting that the
 * customer finished the overlay is NOT proof of payment.
 */

import { apiFetch, withToken } from "./client";

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";
export type PaymentStatus = "pending" | "success" | "failed" | "cancelled";

/** Mirrors `apps/commerce/serializers.py::OrderSerializer`. */
export interface ApiOrder {
  id: string;
  orderId: string;
  /** Django product slug (`heart-map`). */
  productId: string;
  /** Django pack slug (`printable`), which is what order creation expects. */
  deliveryPackId: string;
  projectId: string | null;
  guestEmail: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  status: OrderStatus;
  paymentProvider: string;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPayment {
  id: string;
  orderId: string;
  provider: string;
  providerReference: string | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
}

/** Present only when the active provider is asynchronous (Paddle). With the
 * mock provider the backend completes the charge inline and returns null. */
export interface ApiCheckoutHandle {
  provider: string;
  /** Handed to Paddle.js `Checkout.open({ transactionId })`. */
  transactionId: string;
  /** Paddle's PUBLIC client-side token. The secret API key and webhook
   * secret are never included in any API response. */
  clientToken: string;
}

export interface ApiPayResponse {
  order: ApiOrder;
  payment: ApiPayment | null;
  checkout: ApiCheckoutHandle | null;
}

export interface ApiEntitlement {
  id: string;
  orderId: string;
  productId: string;
  /** An export target id, or `__live__` for the interactive deliverable. */
  targetId: string;
  createdAt: string;
}

export interface ApiEntitlementsResponse {
  orderId: string;
  productId: string;
  entitlements: ApiEntitlement[];
}

/**
 * `backendProductId` is the Django product slug and `deliveryPackId` the
 * pack's slug — the backend scopes the pack lookup to the product, so a
 * pack belonging to a different product cannot be ordered.
 *
 * `projectId` is optional to the API but required in practice for the launch
 * products: the delivery renderers raise without a project, so an order
 * created without one would take payment for something undeliverable.
 *
 * `locale` is the site language the customer is checking out in. It is
 * recorded on the order and is what the delivered keepsake declares as its
 * own language and reading direction, and what any transactional email is
 * written in. Sent rather than asked for — the customer already chose a
 * language by browsing in one.
 *
 * Recorded at purchase, deliberately: re-downloading months later from a
 * browser set to a different language must return the same artifact that
 * was bought, not a re-rendered one.
 */
export async function createOrder(
  backendProductId: string,
  deliveryPackId: string,
  projectId: string,
  locale: string,
  signal?: AbortSignal
): Promise<ApiOrder> {
  return apiFetch<ApiOrder>("/orders", {
    method: "POST",
    body: { productId: backendProductId, deliveryPackId, projectId, locale },
    signal,
  });
}

/**
 * §12 — magic-link access. `withToken` moved to client.ts, alongside
 * `apiFetch` — see it there for what changed and why. Every call site in
 * this file below keeps working unchanged.
 */

export async function getOrder(
  orderId: string,
  signal?: AbortSignal,
  token?: string
): Promise<ApiOrder> {
  return apiFetch<ApiOrder>(withToken(`/orders/${orderId}`, token), { method: "GET", signal });
}

/**
 * Starts (or resumes) payment. Safe to call more than once: the backend
 * reuses an existing pending Paddle transaction rather than creating a
 * second one, returns the existing payment if the order is already paid,
 * and refuses a cancelled order.
 */
export async function payOrder(orderId: string, signal?: AbortSignal): Promise<ApiPayResponse> {
  return apiFetch<ApiPayResponse>(`/orders/${orderId}/pay`, { method: "POST", signal });
}

export async function getOrderEntitlements(
  orderId: string,
  signal?: AbortSignal,
  token?: string
): Promise<ApiEntitlementsResponse> {
  return apiFetch<ApiEntitlementsResponse>(withToken(`/orders/${orderId}/entitlements`, token), {
    method: "GET",
    signal,
  });
}

/**
 * §7c — leave feedback about a purchase.
 *
 * `token` is the same magic-link credential as everything else on the order
 * page: present when the customer arrived from an emailed receipt, absent
 * when they are still in the session that bought it. Ownership is proved
 * server-side either way — this call cannot attach feedback to an order the
 * caller cannot already open.
 */
export async function submitOrderFeedback(
  orderId: string,
  rating: number,
  message: string,
  token?: string,
  signal?: AbortSignal
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/feedback", {
    method: "POST",
    body: { orderId, rating, message, token },
    signal,
  });
}

/**
 * §7c — general site feedback, tied to no order.
 *
 * Unauthenticated by design: someone reporting a broken link should not
 * have to buy something first. That is also why the endpoint is throttled
 * server-side rather than trusting this call site.
 *
 * `rating` is optional here and `email` is too. At least one of rating or
 * message must be present, which the server enforces — an empty submission
 * is a row that means nothing.
 */
export async function submitGeneralFeedback(
  rating: number | null,
  message: string,
  email: string,
  displayName = "",
  signal?: AbortSignal
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/feedback", {
    method: "POST",
    body: { rating, message, email, displayName },
    signal,
  });
}
