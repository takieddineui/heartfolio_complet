"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Search } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// "lost" and "reorder" were removed (Pass A §11) — both were entirely
// built on a customer account ("lives in your account for good", "your
// design lives in your account"), and no account system exists. Reword
// wasn't possible without inventing one, so the entries are gone rather
// than replaced with another unsupported claim.
//
// FAQ_KEYS itself moved to `faq-keys.ts`, which is NOT a "use client" file.
// The homepage's structured data is built server-side and used to import
// it from here — a Server Component reading a data export out of a client
// component's module, which is the exact shape of bug that produced
// `HOMEPAGE_FAQ_KEYS.map is not a function` in production. See that file's
// header for the full explanation.
import { FAQ_KEYS } from "./faq-keys";

export function Faq() {
  const t = useTranslations("Faq");
  const tFeedback = useTranslations("FeedbackPage");
  const [query, setQuery] = useState("");

  const items = useMemo(
    () =>
      FAQ_KEYS.map((key) => ({
        key,
        question: t(`items.${key}.question`),
        answer: t(`items.${key}.answer`),
      })),
    [t]
  );

  const filtered = query
    ? items.filter(
        (item) =>
          item.question.toLowerCase().includes(query.toLowerCase()) ||
          item.answer.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  return (
    <section id="faq" className="bg-card py-24 sm:py-30">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <Reveal className="text-center">
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

        <Reveal delay={0.05} className="relative mt-10">
          <Search
            className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-body/40"
            strokeWidth={1.5}
          />
          <label htmlFor="faq-search" className="sr-only">
            {t("searchPlaceholder")}
          </label>
          <input
            id="faq-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-13 w-full rounded-[var(--radius-md)] border border-subtle bg-page ps-11 pe-4 text-[15px] text-body placeholder:text-body/45 focus:border-champagne-gold focus:outline-none"
          />
        </Reveal>

        <Reveal delay={0.1} className="mt-4">
          <Accordion type="single" collapsible className="w-full">
            {filtered.map((item) => (
              <AccordionItem key={item.key} value={item.key}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-body/60">
              {t("subtitle")}
            </p>
          )}
        </Reveal>

        <Reveal delay={0.15} className="mt-14 rounded-[var(--radius-lg)] bg-page p-8">
          <h3 className="font-serif text-lg text-heading">{t("memorialNote.title")}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-body/75">
            {t("memorialNote.text")}
          </p>
        </Reveal>

        {/*
          §7c — the general feedback invitation, placed here rather than as
          a floating tab on every page.

          Someone who has just read every question and not found theirs is
          already looking for a way to reach a person. That is a better
          moment to offer it than interrupting somebody who is trying to
          buy something.
        */}
        <Reveal delay={0.2} className="mt-8 text-center">
          <p className="text-[15px] text-body/70">
            {tFeedback("faqPrompt")}{" "}
            <Link href="/feedback" className="text-champagne-gold underline underline-offset-4">
              {tFeedback("faqCta")}
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
