"use client";

import { useLocale, useTranslations } from "next-intl";
import { CaptureLoop, PhoneFrame } from "@/components/captures/capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";

/**
 * A product's real capture loop inside a guide, in the guide's language, in a
 * phone frame with a caption. The reusable block every guide embeds captures
 * with (`{ type: "capture" }`).
 *
 * The home page's rules, by construction, because it IS the home page's loop
 * (`CaptureLoop`, `mode="inView"`): no `<video>` before the page has loaded
 * and the phone is on screen, never preloaded, paused off screen or when the
 * tab is hidden, a pause button, stills only under reduced motion or data
 * saver, and the still's real size reserved so nothing jumps. A guide's
 * loops together stay within `GUIDE_VIDEO_BUDGET` (`guides.test.ts`).
 */
export function GuideCapture({ product, name, caption }: { product: string; name: string; caption: string }) {
  const locale = useLocale();
  const t = useTranslations("Captures");
  const captures = getProductCaptures(product, locale);
  if (!captures?.poster) return null;
  return (
    <figure className="mx-auto mt-10 w-[min(68%,250px)]">
      <PhoneFrame>
        <CaptureLoop captures={captures} alt={t("phoneAlt", { name })} mode="inView" />
      </PhoneFrame>
      <figcaption className="mt-4 text-center text-sm leading-relaxed text-body/65">{caption}</figcaption>
    </figure>
  );
}
