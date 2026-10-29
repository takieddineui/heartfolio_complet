import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LivePayloadView, type LivePayload } from "@/components/live/live-payload";
import { getBackendOrigin } from "@/lib/backend-origin";
import { neutralShareMetadata, noindexMetadata } from "@/lib/seo";

/**
 * §10 — the Digital keepsake.
 *
 * A hosted page rather than the self-contained HTML file it used to be.
 * That changed because §5's media cannot be embedded: a 50MB clip becomes
 * roughly 67MB of base64, and eight of them make a file nothing will open.
 *
 * Same access model as the AR page (§21f): no session, one generic 404 for
 * every failure, `noindex`, not linked from anywhere. The person opening it
 * is the gift recipient, who has no Heartfolio account and never will.
 */
export const dynamic = "force-dynamic";

/** What the recipient's tab and a shared link's preview say: "A gift for you —
 *  Heartfolio" in the link's language. It was "Heartfolio — Heartfolio"
 *  (25 Oct 2026). Never indexed. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, liveId } = await params;
  const t = await getTranslations({ locale, namespace: "PageTitles" });
  const share = await getTranslations({ locale, namespace: "ShareCards" });
  const path = `/live/${liveId}`;
  // Never indexed; its own canonical; a neutral card when the link is shared
  // (`seo.ts`). Nothing here reads the keepsake.
  return {
    title: t("live"),
    ...noindexMetadata(locale, path, { follow: false }),
    ...neutralShareMetadata(locale, path, "gift", { title: t("live"), description: share("gift.description") }),
  };
}

type Params = Promise<{ locale: string; liveId: string }>;

/**
 * SERVER-SIDE FETCH, SO IT CANNOT USE `apiFetch`.
 *
 * `apiFetch` builds a RELATIVE url (`/api/backend/...`) because it exists
 * for the browser, where that path is same-origin and carries the guest
 * session cookie first-party. This page is a server component
 * (`force-dynamic`), and on the server a relative url has no origin to
 * resolve against — `fetch` throws immediately, the `catch` below calls
 * `notFound()`, and the recipient sees "this page wandered off" for a
 * keepsake that exists and was paid for. The request never leaves the frontend's server,
 * which is why nothing appears in the browser's network tab or in
 * Django's access log.
 *
 * Same reasoning and same constant as `catalog-server.ts`: go to the
 * backend origin directly. There is no cookie to forward — the live
 * endpoint is `AllowAny` and deliberately session-less (§21f), since the
 * person opening it is the gift recipient, who has no Heartfolio account.
 *
 * THE VISITOR'S ADDRESS IS FORWARDED (26 Oct 2026). Django throttles this
 * endpoint (`ar_access`) by `X-Forwarded-For`. Without it, every recipient
 * reached Django as the web container, one shared bucket, which is why
 * production left `ar_access` at 1000/min. In production the header is
 * Caddy's (it drops any value a client sends), so passing it on gives
 * Django the same identity the browser's own calls already carry.
 */
const REQUEST_TIMEOUT_MS = 8000;

async function fetchLivePayload(
  origin: string,
  liveId: string,
  forwardedFor: string | null
): Promise<LivePayload> {
  const response = await fetch(
    `${origin}/api/v1/live/${encodeURIComponent(liveId)}/`,
    {
      headers: {
        Accept: "application/json",
        ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
      },
      // Never cache a keepsake: the values can be corrected after purchase.
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`Live experience request failed: ${response.status}`);
  }
  return (await response.json()) as LivePayload;
}

export default async function LivePage({ params }: { params: Params }) {
  const { locale, liveId } = await params;
  setRequestLocale(locale);

  // Resolved BEFORE the try, on purpose. The catch below turns every failure
  // into a 404 — correct for "this keepsake is unavailable" (it must not reveal
  // which of several reasons, §21f), and exactly wrong for a missing
  // BACKEND_API_ORIGIN, which would show every recipient "this page wandered
  // off" for a keepsake that exists. A configuration error is the same for every
  // id, so throwing it reveals nothing about any of them.
  const origin = getBackendOrigin();

  const forwardedFor = (await headers()).get("x-forwarded-for");

  let payload: LivePayload;
  try {
    payload = await fetchLivePayload(origin, liveId, forwardedFor);
  } catch {
    // One outcome for every failure, matching Django's single 404 —
    // distinguishing them here would leak the same information one layer
    // up (§21f).
    notFound();
  }

  return <LivePayloadView payload={payload} liveId={liveId} intro />;
}
