import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OrderStatusView } from "@/components/commerce/order-status-view";
import { neutralShareMetadata, noindexMetadata } from "@/lib/seo";

/** "Your order — Heartfolio" in the page's language (it showed the site's
 *  default title, 25 Oct 2026). Never indexed: the address carries a private
 *  access token. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; orderId: string }> }): Promise<Metadata> {
  const { locale, orderId } = await params;
  const t = await getTranslations({ locale, namespace: "PageTitles" });
  const share = await getTranslations({ locale, namespace: "ShareCards" });
  // The canonical and the shared address leave the access token out.
  const path = `/orders/${orderId}`;
  return {
    title: t("order"),
    ...noindexMetadata(locale, path, { follow: false }),
    ...neutralShareMetadata(locale, path, "order", { title: t("order"), description: share("order.description") }),
  };
}

/**
 * `/orders/:id` — where a customer lands if they refresh during checkout,
 * close the tab after paying, or follow the "view order status" link.
 *
 * The modal holds its state in memory, so before this route existed a
 * refresh mid-payment left a paying customer with nowhere to go. The order
 * itself is safe — Django owns it and the webhook confirms it independently
 * of any browser — this route just gives them a way back to it.
 *
 * Status is read client-side for the same reason project loading is: the
 * order belongs to a guest session cookie that lives in the browser, and
 * the server has no session to act on.
 *
 * Since §12 this route is also the destination of the emailed magic link,
 * which carries a token — see below for where that lives now.
 */

/**
 * §12 — `[[...token]]` is Next.js's optional catch-all segment, matching
 * `/orders/<id>` (no token, session-based) and `/orders/<id>/<token>`
 * (magic link) with the SAME page component. It is a catch-ALL rather
 * than a single optional segment because Next.js has no "optional single
 * segment" syntax — `[[...token]]` is the standard way to express "zero
 * or one," constrained to exactly that by only ever reading `token[0]`
 * below and ignoring anything past it.
 *
 * THIS USED TO BE `?token=`, read from `searchParams`. Moved to the path
 * for the reason given where `withToken` is defined (the frontend's own
 * `lib/api/client.ts`) — briefly, a query string is invisible to a cache
 * or proxy configured to key on path alone, which could otherwise serve
 * one customer's cached order to the next visitor who requests the same
 * order id with a different token. AR's and Live's own credentials were
 * path-based from the start for the same reason; this was the one bearer
 * token in the system built the other way.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string; token?: string[] }>;
}) {
  const { locale, orderId, token } = await params;
  setRequestLocale(locale);

  /**
   * §12 — the magic-link credential from the emailed receipt, when present.
   *
   * Read here and handed down rather than pulled from the URL deeper in
   * the tree, so every API call this page makes uses the same credential
   * and there is one place to see that it exists.
   *
   * Absent for the normal in-session path (refresh during checkout, "view
   * order status" link), where the guest cookie still applies. The API
   * layer treats it as optional for exactly that reason.
   */
  return <OrderStatusView orderId={orderId} accessToken={token?.[0]} />;
}
