import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SiteHeader } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { GuideArticle, formatGuideDate } from "@/components/guides/guide-article";
import { typeset } from "@/lib/guides/typeset";
import { findGuide, guideAlternates, moreGuides } from "@/lib/guides/registry";
import type { GuideLocale } from "@/lib/guides/types";
import { captureImageUrls } from "@/lib/captures/manifest";
import { jsonLdScript } from "@/lib/json-ld";
import { ogLocales } from "@/lib/seo";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";

/**
 * A guide (`lib/guides`; plan in CLAUDE.md). An unknown slug, a slug from
 * another language, or a draft in a production build is a REAL 404: no
 * loading skeleton wraps this route, so `notFound()` still sets the status
 * (`seo-status.test.ts`, `guides.test.ts`).
 */
type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const found = findGuide(locale, slug);
  if (!found) return {};
  const { guide, translation } = found;
  const url = `${SITE_URL}/${locale}/guides/${translation.slug}`;
  const draft = translation.status === "draft";
  return {
    title: translation.metaTitle,
    description: translation.description,
    // hreflang between the translations that exist, x-default English.
    alternates: guideAlternates(guide, locale as GuideLocale),
    robots: draft ? { index: false, follow: false } : { index: true, follow: true },
    // No `images`: the `opengraph-image` beside this route draws the card.
    openGraph: {
      type: "article",
      title: translation.title,
      description: translation.description,
      url,
      siteName: SITE_NAME,
      publishedTime: translation.published,
      modifiedTime: translation.updated,
      ...ogLocales(locale),
    },
    twitter: { card: "summary_large_image", title: translation.title, description: translation.description },
  };
}

export default async function GuidePage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const found = findGuide(locale, slug);
  if (!found) notFound();
  const { guide, translation } = found;

  const t = await getTranslations({ locale, namespace: "Guides" });
  const url = `${SITE_URL}/${locale}/guides/${translation.slug}`;
  // The other PUBLISHED guides in this language; none, no block.
  const more = moreGuides(guide.id, locale);
  const author = t("author");

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: translation.title,
    description: translation.description,
    inLanguage: locale,
    datePublished: translation.published,
    dateModified: translation.updated,
    author: { "@type": "Organization", name: author, url: `${SITE_URL}/${locale}` },
    publisher: { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.svg` } },
    // The keepsakes the guide is about, as they really look (`lib/captures`).
    image: guide.products.flatMap((product) => captureImageUrls(product, locale, SITE_URL).slice(0, 1)),
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    about: guide.products.map((product) => ({ "@type": "Product", url: `${SITE_URL}/${locale}/products/${product}` })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: t("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
      { "@type": "ListItem", position: 2, name: t("breadcrumbGuides"), item: `${SITE_URL}/${locale}/guides` },
      { "@type": "ListItem", position: 3, name: translation.title, item: url },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript([articleLd, breadcrumbLd]) }} />
      <SiteHeader />
      <main id="main-content" className="bg-page pb-24 pt-28 sm:pt-32">
        <article className="mx-auto max-w-2xl px-5 sm:px-8">
          <nav aria-label={t("breadcrumbGuides")} className="text-sm text-body/60">
            <Link href="/" className="hover:text-heading">
              {t("breadcrumbHome")}
            </Link>
            <span aria-hidden="true"> › </span>
            <Link href="/guides" className="hover:text-heading">
              {t("breadcrumbGuides")}
            </Link>
          </nav>
          {translation.status === "draft" && (
            <p className="mt-6 inline-block rounded-full border border-dusty-terracotta/50 px-3 py-1 text-xs font-medium text-dusty-terracotta">
              {t("draft")}
            </p>
          )}
          <h1 className="mt-6 font-serif text-4xl leading-tight text-heading sm:text-5xl">{typeset(translation.title, locale)}</h1>
          <p className="mt-5 text-sm text-body/60">
            {t("byline", { author })} · {t("updated", { date: formatGuideDate(translation.updated, locale) })}
          </p>
          <div className="mt-10">
            <GuideArticle translation={translation} locale={locale} />
          </div>
          {more.length > 0 && (
            <nav aria-labelledby="more-ideas" className="mt-16 border-t border-subtle pt-10">
              <h2 id="more-ideas" className="font-serif text-2xl text-heading">
                {typeset(t("moreIdeas"), locale)}
              </h2>
              <ul className="mt-5 space-y-4">
                {more.map(({ guide: other, translation: otherTranslation }) => (
                  <li key={other.id}>
                    <Link href={`/guides/${otherTranslation.slug}`} className="group block">
                      <span className="font-serif text-lg text-heading group-hover:text-champagne-gold">{typeset(otherTranslation.title, locale)}</span>
                      <span className="mt-1 block text-[15px] leading-relaxed text-body/70">{typeset(otherTranslation.description, locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
