"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { getOrder, getOrderEntitlements, type ApiEntitlement, type ApiOrder } from "@/lib/api/orders";
import { LIVE_TARGET_ID } from "@/types/commerce";
import { resolveShellText } from "@/lib/studio/i18n";
import { formatCents } from "@/lib/studio/pricing-engine";
import { Card } from "@/components/studio/ui/card";
import { OrderDownloads } from "@/components/commerce/order-downloads";
import { OrderFeedback } from "@/components/commerce/order-feedback";
import { ARTargetCompiler } from "@/components/commerce/ar-target-compiler";
import { OtherProducts } from "@/components/commerce/other-products";

/**
 * Reuses the checkout modal's existing visual language — the same Card, the
 * same icons, the same copy keys — rather than introducing a new page
 * design for what is the same information in a different place.
 *
 * A pending order keeps polling: the customer may have arrived here while
 * the webhook was still in flight, and the page should resolve itself
 * rather than require a manual refresh.
 *
 * An order that is missing or belongs to someone else renders exactly the
 * same "unavailable" state — the API distinguishes 403 from 404, but this
 * view deliberately does not, so the page cannot be used to discover
 * whether a given order id exists.
 */
export function OrderStatusView({
  orderId,
  /** §12 magic-link token, when the customer arrived from an emailed
   *  receipt rather than an in-session redirect. Undefined otherwise. */
  accessToken,
}: {
  orderId: string;
  accessToken?: string;
}) {
  const locale = useLocale();
  const st = (key: string) => resolveShellText(key, locale);

  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [entitlements, setEntitlements] = useState<ApiEntitlement[]>([]);
  // §21i — only an AR purchase compiles a target, and only one
  // entitlement in an order ever carries the card.
  const arCardEntitlement = entitlements.find((e) => e.targetId.startsWith("ar-"));
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const current = await getOrder(orderId, undefined, accessToken);
        if (cancelled) return;
        setOrder(current);

        if (current.status === "paid") {
          setEntitlements((await getOrderEntitlements(orderId, undefined, accessToken)).entitlements);
          return;
        }
        if (current.status === "pending") {
          timer = setTimeout(poll, 4000);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, accessToken]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6 py-24">
      <Card className="w-full bg-page p-6">
        {unavailable ? (
          <div className="space-y-4 text-center">
            <XCircle className="mx-auto h-10 w-10 text-error-warm" strokeWidth={1.5} />
            <h1 className="font-serif text-lg text-heading">{st("checkout.failedTitle")}</h1>
            <p className="text-sm text-body/70">{st("checkout.orderUnavailable")}</p>
          </div>
        ) : !order ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-champagne-gold" />
          </div>
        ) : order.status === "paid" ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-muted-sage" strokeWidth={1.5} />
            <div>
              <h1 className="font-serif text-lg text-heading">{st("checkout.successTitle")}</h1>
              <p className="mt-1 text-sm text-body/70">{st("checkout.successBody")}</p>
            </div>
            <div className="flex justify-between rounded-[var(--radius-md)] bg-champagne-gold/10 px-4 py-3 text-sm font-medium text-heading">
              <span>{st("checkout.total")}</span>
              <span>{formatCents(order.totalCents, order.currency, locale)}</span>
            </div>
            <OrderDownloads orderId={order.orderId} entitlements={entitlements} accessToken={accessToken} />

            {/*
              §10 — the review box, and the "other products" strip below it.

              Both are placed after the downloads on purpose. The customer
              came here for their files; asking for a rating or offering
              another purchase above the thing they paid for would put our
              interests ahead of theirs on the page that confirms the sale.
            */}
            {/*
              §21i — compile the AR tracking target now, in the buyer's
              browser, rather than leaving it to the recipient's first scan.
              Mounted only for an AR entitlement; every other purchase never
              loads the compiler at all.
            */}
            {arCardEntitlement && (
              <ARTargetCompiler
                entitlementId={arCardEntitlement.id}
                accessToken={accessToken}
              />
            )}

            <div className="pt-2">
              <OrderFeedback orderId={order.orderId} accessToken={accessToken} />
            </div>

            <OtherProducts purchasedProductId={order.productId} />
          </div>
        ) : order.status === "pending" ? (
          <div className="space-y-4 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-champagne-gold" strokeWidth={1.5} />
            <h1 className="font-serif text-lg text-heading">{st("checkout.pendingTitle")}</h1>
            <p className="text-sm text-body/70">{st("checkout.pendingBody")}</p>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <XCircle className="mx-auto h-10 w-10 text-error-warm" strokeWidth={1.5} />
            <h1 className="font-serif text-lg text-heading">
              {order.status === "cancelled" ? st("checkout.cancelledTitle") : st("checkout.failedTitle")}
            </h1>
            <p className="text-sm text-body/70">
              {order.status === "cancelled" ? st("checkout.cancelledBody") : st("checkout.failedBody")}
            </p>
          </div>
        )}
      </Card>
    </main>
  );
}
