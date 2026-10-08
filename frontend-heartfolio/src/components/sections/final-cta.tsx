"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { CelestialSequence } from "@/components/motion/celestial-sequence";

export function FinalCta() {
  const t = useTranslations("FinalCta");

  return (
    <section className="relative overflow-hidden bg-ink-navy py-28 text-parchment sm:py-36">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 70% at 50% 100%, rgba(201,162,75,0.12), transparent 60%)",
        }}
      />
      <CelestialSequence
        seed={42}
        starCount={60}
        heartCount={3}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      />

      <div className="relative mx-auto max-w-2xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="font-serif text-4xl leading-tight sm:text-5xl">
            {t("title").split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          <p className="mt-6 text-lg text-parchment/75">{t("subtitle")}</p>
          <div className="mt-10 flex flex-col items-center gap-4">
            <Button variant="onDark" size="lg" asChild>
              <Link href="/create">
                {t("cta")}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            </Button>
            <p className="text-xs uppercase tracking-[0.12em] text-parchment/45">{t("trust")}</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
