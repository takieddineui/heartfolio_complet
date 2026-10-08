"use client";

import { useTranslations } from "next-intl";
import { Check, Minus } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { ConstellationMark } from "@/components/illustrations/constellation";

const PILLAR_KEYS = ["design", "instant", "print"] as const;

export function WhyHeartfolio() {
  const t = useTranslations("WhyHeartfolio");
  const usPoints = t.raw("comparison.us.points") as string[];
  const themPoints = t.raw("comparison.them.points") as string[];

  return (
    <section id="why" className="bg-card py-24 sm:py-30">
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

        <RevealGroup className="mt-16 grid gap-10 sm:grid-cols-3">
          {PILLAR_KEYS.map((key) => (
            <RevealItem key={key} className="border-t border-subtle pt-6">
              <h3 className="font-serif text-lg text-heading">{t(`pillars.${key}.title`)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-body/70">
                {t(`pillars.${key}.description`)}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>

        {/* Was a customer testimonial attributed to "Adrian, Star Map
            customer". Removed: Heartfolio has not launched, so that
            review describes a purchase nobody has made. Fabricated social
            proof is a problem on its own terms, and §29 rules it out
            explicitly. Replaced with a brand statement in our own voice —
            an honest claim rather than a borrowed one. Put a real,
            attributable quote back here once real customers exist. */}
        <Reveal delay={0.05} className="mt-20 border-y border-subtle py-14">
          <div className="mx-auto max-w-2xl text-center">
            <ConstellationMark className="mx-auto h-6 w-28 opacity-70" />
            <p className="mt-8 font-serif text-2xl leading-snug text-heading sm:text-3xl">
              {t("statement.text")}
            </p>
            <p className="mt-5 text-sm uppercase tracking-[0.1em] text-body/55">
              {t("statement.attribution")}
            </p>
          </div>
        </Reveal>

        {/*
          TODO(HEARTFOLIO-PREDEPLOY):
          Re-evaluate the Why Heartfolio comparison presentation.
          Goal: editorial/brand manifesto feeling rather than SaaS feature
          comparison. Identified during Pass B as the one remaining visual
          weakness — two bordered cards with checkmarks vs. dashes is a
          recognizable SaaS/feature-comparison pattern even though the
          copy itself reads well. Do not redesign now. The positioning
          itself ("We're not a design tool. We're a craftsman.") and the
          surrounding pillars are approved and must not be removed —
          this TODO is about the visual treatment of the two-column
          comparison block specifically.
        */}
        {/* Quiet differentiation: what we leave out */}
        <Reveal delay={0.1} className="mt-20">
          <h3 className="text-center font-serif text-2xl text-heading">
            {t("comparison.title")}
          </h3>
          <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] bg-ink-navy p-8 text-parchment">
              <p className="font-serif text-lg text-champagne-gold">{t("comparison.us.label")}</p>
              <ul className="mt-5 space-y-3.5">
                {usPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-[15px] text-parchment/85">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-champagne-gold" strokeWidth={1.75} />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-subtle p-8">
              <p className="font-serif text-lg text-body/60">{t("comparison.them.label")}</p>
              <ul className="mt-5 space-y-3.5">
                {themPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-[15px] text-body/60">
                    <Minus className="mt-0.5 h-4 w-4 shrink-0 text-body/35" strokeWidth={1.75} />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
