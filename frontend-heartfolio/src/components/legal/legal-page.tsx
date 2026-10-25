"use client";

import { useLocale, useTranslations } from "next-intl";
import { HOSTING_PROVIDER, LEGAL_CONTROLLER, LEGAL_LAST_UPDATED, SUPPORT_EMAIL } from "@/lib/site-config";

export type LegalKey = "privacy" | "terms" | "refunds" | "contact";

interface Section {
  title: string;
  body: string[];
}

/**
 * One layout for all four policy pages (§18–§20). Content lives in the
 * message files so Privacy / Terms / Refunds / Contact are as translated
 * as the rest of the site — a French or Arabic buyer should not hit an
 * English-only refund policy at the exact moment they need it.
 *
 * `{email}` in any string is substituted with the single support address
 * from site-config, so there is one place to change it. The intro is an ICU
 * message and gets the address as a VALUE; called without one, next-intl
 * printed the key, "Legal.contact.intro", on the contact page in every
 * language (found 25 Oct 2026). The section bodies are read raw and still
 * hold the token. `fill` turns the address, either way, into a mailto link.
 *
 * The owner's facts work the same way (25 Oct 2026): `{controller}` (who
 * sells and is responsible for the data), `{hosting}` and `{updated}` come
 * from site-config, so filling them in at deploy is one edit for all three
 * languages. `{updated}` is the publication date in the page's own date
 * format, or a visible placeholder until it is set.
 */
export function LegalPage({ legalKey }: { legalKey: LegalKey }) {
  const t = useTranslations(`Legal.${legalKey}`);
  const locale = useLocale();
  const sections = t.raw("sections") as Section[];
  // The owner's facts are usually Latin text with commas ("Name, address,
  // country"); inside an Arabic sentence the bidi algorithm reordered their
  // parts (seen on /ar/privacy, 25 Oct 2026). A first-strong isolate (U+2068
  // ... U+2069, invisible) keeps each value in its own direction and order.
  const values = {
    email: SUPPORT_EMAIL,
    controller: isolate(LEGAL_CONTROLLER),
    hosting: isolate(HOSTING_PROVIDER),
    updated: isolate(lastUpdated(locale)),
  };
  const fill = (text: string) => linkSupport(substitute(text, values));

  return (
    <main id="main-content" className="bg-page pb-20 pt-16 md:pb-0">
      <div className="mx-auto max-w-3xl px-5 pb-24 sm:px-8">
        <header>
          <h1 className="font-serif text-4xl leading-[1.15] text-heading sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-sm text-body/55">{t("updated", values)}</p>
          <p className="mt-6 text-lg leading-relaxed text-body/75">{fill(t("intro", values))}</p>
        </header>

        <div className="mt-14 space-y-12">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-serif text-2xl text-heading">{section.title}</h2>
              <div className="mt-4 space-y-4">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-body/75">
                    {fill(paragraph)}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

/** The support address as a mailto link. */
function supportLink(key: string) {
  return (
    <a
      key={key}
      href={`mailto:${SUPPORT_EMAIL}`}
      className="underline decoration-champagne-gold decoration-1 underline-offset-4 hover:text-heading"
    >
      {SUPPORT_EMAIL}
    </a>
  );
}

/** The publication date in the page's language, or the placeholder that
 *  marks it as not yet set. */
function lastUpdated(locale: string): string {
  if (!LEGAL_LAST_UPDATED) return "[date set when the pages go live]";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${LEGAL_LAST_UPDATED}T00:00:00Z`));
}

/** Wraps text in a first-strong isolate so a sentence in the other direction
 *  cannot reorder its parts. */
function isolate(text: string): string {
  return `⁨${text}⁩`;
}

/** Every `{name}` token a raw section string may hold. */
function substitute(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (token, name: string) => values[name] ?? token);
}

/** The support address, wherever it appears, as a real mailto link. */
function linkSupport(text: string) {
  const parts = text.split(SUPPORT_EMAIL);
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) => (i === 0 ? [part] : [supportLink(`mail-${i}`), part]));
}
