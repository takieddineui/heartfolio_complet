import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ARScene } from "@/components/ar/ar-scene";
import { apiFetch } from "@/lib/api/client";

/**
 * §21f — the AR experience page, reached by scanning a QR.
 *
 * NO SESSION, BY DESIGN. The person here is the gift recipient; they have
 * no Heartfolio account and never will. Possession of the unguessable URL
 * is the access mechanism, and every check that matters happens server-side
 * in Django — this page cannot grant access, only display what Django
 * already agreed to return.
 *
 * NOINDEX, and not linked from anywhere in site navigation. Django sends
 * `X-Robots-Tag` on the API response; this sends the meta equivalent for
 * the page itself. A crawler reaching either must not index it.
 *
 * Rendered per request. §21e is explicit that nothing is snapshotted: the
 * scene is built fresh from the project every time, which is also what
 * makes a revoked experience stop working immediately rather than at the
 * next deploy.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Heartfolio",
  robots: { index: false, follow: false, nocache: true },
};

type Params = Promise<{ locale: string; arId: string }>;

interface ARPayload {
  arId: string;
  target: string;
  /** §21c — chosen by the product module, never by the customer and never
   *  inferred from the data. See `ar_support.py`. */
  scene: string;
  /** §15 — "basic" or "enhanced", derived server-side from what the
   *  customer actually provided. Never "advanced": the vocabulary exists,
   *  the experience does not. */
  level: string;
  /** §5 — fresh, ownership-checked access URLs, resolved server-side per
   *  request (`_resolve_milestone_asset_url` in `ar_views.py`), the same
   *  way Song Poster's own live photo already was. These used to be bare
   *  asset ids on the promise that "the client resolves them through the
   *  same ownership-checked path as everything else" — no such client-side
   *  path ever existed, so a milestone's recorded voice note or video
   *  reached this payload correctly and then had nowhere to load from. */
  media: {
    backgroundMusic: string | null;
    milestones: { video: string | null; audio: string | null }[];
  };
  /** §21i — null for a shared-target card. */
  targetUrl: string | null;
  needsTarget: boolean;
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
}

export default async function ARPage({ params }: { params: Params }) {
  const { locale, arId } = await params;
  setRequestLocale(locale);

  let payload: ARPayload;
  try {
    payload = await apiFetch<ARPayload>(`/ar/${encodeURIComponent(arId)}`, { method: "GET" });
  } catch {
    /**
     * One outcome for every failure, matching Django's single 404.
     *
     * A page that distinguished "revoked" from "never existed" from
     * "unpaid" would undo the whole point of the API returning one generic
     * response — the information would just leak one layer up instead.
     */
    notFound();
  }

  return (
    <ARScene
      scene={payload.scene}
      level={payload.level}
      media={payload.media}
      targetUrl={payload.targetUrl}
      needsTarget={payload.needsTarget}
      hasMedia={
        Boolean(payload.media?.backgroundMusic) ||
        (payload.media?.milestones ?? []).some((m) => m.video || m.audio)
      }
      values={payload.values}
      themeSelections={payload.themeSelections}
    />
  );
}
