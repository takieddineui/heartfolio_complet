"use client";

import { useTranslations } from "next-intl";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { StarField } from "@/components/motion/star-field";

type MoodKey = "midnight" | "warmIvory" | "vintageChart" | "goldenHour";

const MOODS: { key: MoodKey; swatch: string }[] = [
  { key: "midnight", swatch: "bg-ink-navy" },
  { key: "warmIvory", swatch: "bg-parchment" },
  { key: "vintageChart", swatch: "bg-[#e9e2d2]" },
  { key: "goldenHour", swatch: "bg-[#e7cba0]" },
];

function MoodPreview({ mood }: { mood: MoodKey }) {
  if (mood === "midnight") {
    return (
      <div className="relative h-full w-full bg-ink-navy">
        <StarField count={34} seed={21} twinkle className="absolute inset-0 h-full w-full" />
      </div>
    );
  }
  if (mood === "warmIvory") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-parchment">
        <p className="font-serif text-sm italic text-soft-charcoal/60">the night we met</p>
      </div>
    );
  }
  if (mood === "vintageChart") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#e9e2d2]">
        <svg viewBox="0 0 100 100" className="h-2/3 w-2/3 text-soft-charcoal/60">
          <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="50" cy="50" r="22" fill="none" stroke="currentColor" strokeWidth="0.4" />
          <line x1="50" y1="16" x2="50" y2="84" stroke="currentColor" strokeWidth="0.4" />
          <line x1="16" y1="50" x2="84" y2="50" stroke="currentColor" strokeWidth="0.4" />
        </svg>
      </div>
    );
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: "linear-gradient(160deg, #b5654b 0%, #e7cba0 70%)",
      }}
    >
      <p className="font-serif text-sm text-ink-navy/70">golden hour</p>
    </div>
  );
}

export function TemplateGallery() {
  const t = useTranslations("TemplateGallery");

  return (
    <section className="bg-page py-24 sm:py-30">
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

        <RevealGroup className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {MOODS.map((mood) => (
            <RevealItem key={mood.key}>
              <div className="group overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-whisper)] transition-shadow duration-300 hover:shadow-[var(--shadow-lift)]">
                <div className="aspect-[3/4] overflow-hidden">
                  <div className="h-full w-full transition-transform duration-[600ms] ease-[var(--ease-heartfolio)] group-hover:scale-[1.03]">
                    <MoodPreview mood={mood.key} />
                  </div>
                </div>
                <div className="bg-card p-5">
                  <h3 className="font-serif text-lg text-heading">{t(`items.${mood.key}.name`)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-body/70">
                    {t(`items.${mood.key}.description`)}
                  </p>
                </div>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal delay={0.1} className="mt-10 text-center">
          <p className="text-sm italic text-body/55">{t("note")}</p>
        </Reveal>
      </div>
    </section>
  );
}
