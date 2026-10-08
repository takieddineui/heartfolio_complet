"use client";

import type { OfferingType } from "@/lib/products/types";
import { KeepsakeVisual } from "./keepsake-visual";

/**
 * A quiet presentation frame for each offering — a framed print on a
 * wall, a phone, a screen — drawn in fine linework rather than filled
 * with stock photography (§7). The product's own artwork sits inside it,
 * so the artwork stays the star.
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * Replace these temporary line-drawn mockup frames with final offering
 * visuals before deployment, per product and per offering type where
 * appropriate: Digital, Printable, Wallpaper, AR, VR, Complete Pack.
 * Remember Digital means the native digital/web experience of the
 * product, not simply "PNG/PDF" — its presentation should reflect that,
 * not just reuse the same screen-on-a-plain-surface frame used here as a
 * placeholder. Do not invent offerings a product doesn't have; the set
 * of offerings shown will ultimately come from the Django Products API.
 * Specific documented placeholders below:
 *   printable     — "Framed Heartfolio print on a warm minimal interior
 *                    wall, editorial photography, natural light, no people."
 *   wallpaper     — "Single smartphone on a plain neutral surface,
 *                    artwork on screen, soft daylight."
 *   complete_pack — "Digital, printed and phone versions in one calm
 *                    composition, overhead, warm neutral surface."
 *   ar / vr       — short demonstration clip, tasteful, no headset stock photo;
 *                   do not overemphasize these merely because they are
 *                   technologically interesting (Pass B §7).
 * Swap the inner wrapper for <Image> when those exist; the aspect ratios hold.
 */
export function OfferingVisual({
  type,
  productId,
}: {
  type: OfferingType;
  productId: string;
}) {
  if (type === "wallpaper") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-subtle/25 p-6">
        <div className="relative h-full max-h-[220px] w-[110px] overflow-hidden rounded-[22px] border border-heading/15 shadow-[var(--shadow-lift)]">
          <div className="absolute left-1/2 top-1.5 z-10 h-1 w-8 -translate-x-1/2 rounded-full bg-heading/20" />
          <KeepsakeVisual productId={productId} />
        </div>
      </div>
    );
  }

  if (type === "printable") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-subtle/25 p-6">
        <div className="relative aspect-[3/4] h-full max-h-[220px] border-[6px] border-heading/15 bg-card p-1.5 shadow-[var(--shadow-lift)]">
          <div className="h-full w-full overflow-hidden">
            <KeepsakeVisual productId={productId} />
          </div>
        </div>
      </div>
    );
  }

  if (type === "complete_pack") {
    return (
      <div className="relative flex h-full w-full items-center justify-center gap-3 bg-subtle/25 p-6">
        <div className="aspect-[3/4] h-3/5 overflow-hidden border-[5px] border-heading/15 bg-card shadow-[var(--shadow-lift)]">
          <KeepsakeVisual productId={productId} />
        </div>
        <div className="aspect-[3/4] h-4/5 overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-lift)]">
          <KeepsakeVisual productId={productId} />
        </div>
        <div className="h-3/5 w-[52px] overflow-hidden rounded-[14px] border border-heading/15 shadow-[var(--shadow-lift)]">
          <KeepsakeVisual productId={productId} />
        </div>
      </div>
    );
  }

  // A framed print beside a screen — the two base units together.
  if (type === "printable_plus_digital") {
    return (
      <div className="relative flex h-full w-full items-center justify-center gap-4 bg-subtle/25 p-6">
        <div className="aspect-[3/4] h-3/5 overflow-hidden border-[5px] border-heading/15 bg-card shadow-[var(--shadow-lift)]">
          <KeepsakeVisual productId={productId} />
        </div>
        <div className="aspect-[4/5] h-4/5 overflow-hidden rounded-[var(--radius-md)] shadow-[var(--shadow-lift)]">
          <KeepsakeVisual productId={productId} />
        </div>
      </div>
    );
  }

  // digital / ar / vr — the artwork on a plain screen surface.
  return (
    <div className="flex h-full w-full items-center justify-center bg-subtle/25 p-6">
      <div className="aspect-[4/5] h-full max-h-[220px] overflow-hidden rounded-[var(--radius-md)] shadow-[var(--shadow-lift)]">
        <KeepsakeVisual productId={productId} />
      </div>
    </div>
  );
}
