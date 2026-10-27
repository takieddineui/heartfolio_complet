import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { SiteHeader } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { formatGuideDate } from "@/components/guides/guide-article";
import { guideIndexAlternates, guidesIn } from "@/lib/guides/registry";
import { jsonLdScript } from "@/lib/json-ld";
import { collectionPageLd, ogLocales } from "@/lib/seo";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";

/**
 * The guides of one language. A language with none has no index (a real
 * 404, as an unknown guide is), so no empty page and no hreflang to it.
 */
type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (guidesIn(locale).length === 0) return {};
  const t = await getTranslations({ locale, namespace: "Guides" });
  const published = guidesIn(locale, { includeDrafts: false }).length > 0;
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: guideIndexAlternates(locale),
    robots: published ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      title: t("meta.title"),
      description: t("meta.description"),
      url: `${SITE_URL}/${locale}/guides`,
      siteName: SITE_NAME,
      ...ogLocales(locale),
    },
    twitter: { card: "summary_large_image", title: t("meta.title"), description: t("meta.description") },
  };
}

export default async function GuidesIndexPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const guides = guidesIn(locale);
  if (guides.length === 0) notFound();
  const t = await getTranslations({ locale, namespace: "Guides" });

  const listLd = collectionPageLd({
    name: t("meta.title"),
    description: t("meta.description"),
    url: `${SITE_URL}/${locale}/guides`,
    items: guides.map(({ translation }) => ({ name: translation.title, url: `${SITE_URL}/${locale}/guides/${translation.slug}` })),
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(listLd) }} />
      <SiteHeader />
      <main id="main-content" className="bg-page pb-24 pt-28 sm:pt-32">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">{t("eyebrow")}</p>
          <h1 className="mt-4 font-serif text-4xl leading-tight text-heading sm:text-5xl">{t("title")}</h1>
          <p className="mt-5 text-lg leading-relaxed text-body/75">{t("intro")}</p>
          <ul className="mt-14 space-y-6">
            {guides.map(({ guide, translation }) => (
              <li key={guide.id}>
                <Link
                  href={`/guides/${translation.slug}`}
                  className="group block rounded-[var(--radius-lg)] bg-card p-7 shadow-[var(--shadow-whisper)] transition-shadow hover:shadow-[var(--shadow-lift)]"
                >
                  <h2 className="font-serif text-2xl text-heading">{translation.title}</h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-body/75">{translation.description}</p>
                  <p className="mt-4 flex items-center justify-between gap-4 text-sm text-body/60">
                    <span>
                      {translation.status === "draft" ? `${t("draft")} · ` : ""}
                      {t("updated", { date: formatGuideDate(translation.updated, locale) })}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-medium text-heading">
                      {t("read")}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden="true" />
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
