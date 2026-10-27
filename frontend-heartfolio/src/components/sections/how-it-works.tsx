"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link2 } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { CaptureLoop, CaptureStill } from "@/components/captures/capture-media";
import { getProductCaptures, getStudioCaptures } from "@/lib/captures/manifest";
import { SITE_URL } from "@/lib/site-config";

const STEP_KEYS = ["one", "two", "three"] as const;

/** The product whose QR card step three shows. */
const QR_PRODUCT = "love-story-timeline";

function StepVisual({ step }: { step: (typeof STEP_KEYS)[number] }) {
  const t = useTranslations("Captures");
  const locale = useLocale();
  const studio = getStudioCaptures(locale);
  const qr = getProductCaptures(QR_PRODUCT, locale)?.qr;

  if (step === "one" && studio?.edit) {
    return (
      <div className="w-full overflow-hidden rounded-[var(--radius-md)] shadow-[var(--shadow-float)]">
        <CaptureLoop captures={studio.edit} alt={t("studioEditAlt")} mode="inView" />
      </div>
    );
  }
  if (step === "two" && studio?.preview) {
    return (
      <div className="w-[82%] overflow-hidden rounded-[var(--radius-md)] shadow-[var(--shadow-float)]">
        <CaptureStill still={studio.preview} alt={t("studioPreviewAlt")} />
      </div>
    );
  }
  if (step === "three" && qr) {
    return (
      <div className="flex w-full flex-col items-center gap-4">
        <div className="w-[52%] overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-float)] ring-1 ring-subtle">
          <CaptureStill still={qr} alt={t("qrAlt")} />
        </div>
        {/* The order page's gift link, as the buyer sees it. An address, not
            copy: it reads left to right in every language. */}
        <p
          dir="ltr"
          aria-hidden="true"
          className="flex max-w-full items-center gap-2 truncate rounded-full border border-subtle bg-card px-4 py-1.5 font-mono text-xs text-body/70 shadow-[var(--shadow-whisper)]"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0 text-champagne-gold" strokeWidth={1.75} />
          {new URL(SITE_URL).host}/live/…
        </p>
      </div>
    );
  }
  return null;
}

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  return (
    <section id="how-it-works" className="bg-card py-24 sm:py-30">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-heading sm:text-4xl md:text-5xl">
            {t("title").split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-body/75">{t("subtitle")}</p>
        </Reveal>

        {/*
          Each step shows the real thing (lib/captures): the Studio as a name
          is typed and the preview follows; the Studio's own phone preview;
          the gift QR card a customer receives, beside the gift link. Pass B
          had taken illustrated "software" icons off these steps; real
          captures say more than either.
        */}
        <RevealGroup className="mt-16 grid gap-x-10 gap-y-16 lg:grid-cols-3">
          {STEP_KEYS.map((key, i) => (
            <RevealItem key={key}>
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] bg-page p-5 sm:p-7">
                <StepVisual step={key} />
              </div>
              <div className="mt-7 flex items-baseline gap-4">
                <p className="font-serif text-2xl text-champagne-gold">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="font-serif text-xl text-heading">{t(`steps.${key}.title`)}</h3>
              </div>
              <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-body/70">{t(`steps.${key}.description`)}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
