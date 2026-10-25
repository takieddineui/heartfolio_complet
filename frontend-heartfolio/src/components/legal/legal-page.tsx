"use client";

import { useTranslations } from "next-intl";
import { SUPPORT_EMAIL } from "@/lib/site-config";

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
 */
export function LegalPage({ legalKey }: { legalKey: LegalKey }) {
  const t = useTranslations(`Legal.${legalKey}`);
  const sections = t.raw("sections") as Section[];

  return (
    <main id="main-content" className="bg-page pb-20 pt-16 md:pb-0">
      <div className="mx-auto max-w-3xl px-5 pb-24 sm:px-8">
        <header>
          <h1 className="font-serif text-4xl leading-[1.15] text-heading sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-sm text-body/55">{t("updated")}</p>
          <p className="mt-6 text-lg leading-relaxed text-body/75">{fill(t("intro", { email: SUPPORT_EMAIL }))}</p>
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

/** The support address, as the `{email}` token or already formatted in, as a
 *  real mailto link. */
function fill(text: string) {
  const parts = text.replaceAll("{email}", SUPPORT_EMAIL).split(SUPPORT_EMAIL);
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) => (i === 0 ? [part] : [supportLink(`mail-${i}`), part]));
}
