"use client";

import { useTranslations } from "next-intl";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";

const STEP_KEYS = ["one", "two", "three", "four"] as const;

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
          Pass B §8, §15: each step used to sit under a small illustrated
          square — a spinning dashed circle (a loading spinner), three
          color swatches (a color picker), a download arrow inside a
          sliding-highlight box (a download button). Read individually
          they're fine ideas; together they're literal software UI
          iconography, which is exactly the "enter data → generate →
          download" feeling the brief asks to avoid. The serif numerals
          were already doing real work underneath — this leans on them and
          the typography instead, restrained rather than illustrated.
        */}
        <RevealGroup className="mt-16 grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
          {STEP_KEYS.map((key, i) => (
            <RevealItem key={key} className="border-t border-subtle pt-7">
              <p className="font-serif text-3xl text-champagne-gold">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-4 font-serif text-xl text-heading">{t(`steps.${key}.title`)}</h3>
              <p className="mt-2 max-w-[240px] text-[15px] leading-relaxed text-body/70">
                {t(`steps.${key}.description`)}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
