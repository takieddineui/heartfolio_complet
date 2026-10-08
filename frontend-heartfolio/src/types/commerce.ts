/** Sentinel target id for a non-exported (hosted/interactive) delivery
 * entitlement, e.g. a "Live" pack. Shared so no module/catalog invents
 * its own magic string for the same concept. */
export const LIVE_TARGET_ID = "__live__";

export interface DeliveryPack {
  id: string;
  productId: string;
  /** Translation keys, resolved against the owning module's `messages`. */
  nameKey: string;
  descriptionKey: string;
  priceCents: number;
  currency: string;
  /** Export target/format ids this pack grants (matching
   * `ExportFormat.id` under the product's `delivery.export.targets`),
   * or `LIVE_TARGET_ID` for a hosted/interactive entitlement. */
  includedTargets: string[];
}

export interface OrderPricing {
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";
export type PaymentResult = "success" | "failed" | "cancelled";

export interface Order {
  orderId: string;
  projectId?: string;
  productId: string;
  guestEmail: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  status: OrderStatus;
  paymentProvider: string;
  paymentStatus: PaymentResult | "pending";
  deliveryPackId: string;
  createdAt: string;
}

export interface Entitlement {
  orderId: string;
  productId: string;
  targetId: string;
}
