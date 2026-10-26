import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LivePayloadView, type LivePayload } from "@/components/live/live-payload";
import { captureModeEnabled, isCaptureProduct } from "@/lib/captures/capture-mode";
import { readCapturePayload } from "@/lib/captures/capture-payload";

/**
 * DEV ONLY: a sample keepsake's real live page, for the storefront captures
 * (`scripts/captures/record.mjs`). It renders the payload the backend's own
 * builder produced for a fictional sample through the same `LivePayloadView`
 * as `/live/<id>`, so a capture shows exactly what a recipient sees.
 *
 * Locked behind `HEARTFOLIO_CAPTURE=1` on a development server
 * (`captureModeEnabled`); otherwise the proxy already answered 404 before
 * this page runs, and this check is the second lock.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

type Params = Promise<{ locale: string; product: string }>;

export default async function CapturePage({ params }: { params: Params }) {
  const { locale, product } = await params;
  if (!captureModeEnabled() || !isCaptureProduct(product)) notFound();
  setRequestLocale(locale);

  const payload = await readCapturePayload(product, locale);
  if (!payload) notFound();

  return <LivePayloadView payload={payload as LivePayload} liveId="capture-sample" />;
}
