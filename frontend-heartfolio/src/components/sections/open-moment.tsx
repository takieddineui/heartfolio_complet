"use client";

import { useLocale, useTranslations } from "next-intl";
import { Reveal } from "@/components/motion/reveal";
import { CaptureLoop, CaptureStill, PhoneFrame } from "@/components/captures/capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";

/** The keepsake this section opens: its QR card, then its live page. */
const PRODUCT = "love-story-timeline";

/**
 * "The moment they open it": the recipient's side. The gift QR card, and the
 * phone it opens on, playing Love Story Timeline's real opening into its
 * first milestones (lib/captures). It does not promise "in their language":
 * the page follows the language the buyer ordered in.
 */
export function OpenMoment() {
  const t = useTranslations("OpenMoment");
  const tCaptures = useTranslations("Captures");
  const tProducts = useTranslations("Products");
  const locale = useLocale();
  const captures = getProductCaptures(PRODUCT, locale);

  return (
    <section id="moment" className="overflow-hidden bg-ink-navy py-24 text-parchment sm:py-30">
      <div className="mx-auto grid max-w-7xl items-center gap-16 px-5 sm:px-8 lg:grid-cols-2">
        <Reveal className="max-w-xl">
          <h2 className="font-serif text-3xl leading-tight sm:text-4xl md:text-5xl">{t("title")}</h2>
          <p className="mt-6 text-lg leading-relaxed text-parchment/75">{t("subtitle")}</p>
        </Reveal>

        {captures && (
          <Reveal delay={0.1} className="flex items-center justify-center gap-6 sm:gap-10">
            {captures.qr && (
              <div className="w-[38%] max-w-[210px] -rotate-3 overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-float)] ring-1 ring-parchment/20 rtl:rotate-3">
                <CaptureStill still={captures.qr} alt={tCaptures("qrAlt")} />
              </div>
            )}
            <PhoneFrame className="w-[46%] max-w-[250px]">
              <CaptureLoop
                captures={captures}
                alt={tCaptures("phoneAlt", { name: tProducts("loveStoryTimeline.name") })}
                mode="inView"
              />
            </PhoneFrame>
          </Reveal>
        )}
      </div>
    </section>
  );
}
