import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { GeneralFeedbackForm } from "@/components/feedback/general-feedback-form";
import { buildAlternates, pageShareMetadata } from "@/lib/seo";

const PATH = "/feedback";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "FeedbackPage" });
  const tMeta = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: buildAlternates(locale, PATH),
    // Its own share title and address, with the site's card (`seo.ts`).
    ...pageShareMetadata(locale, PATH, { title: t("meta.title"), description: t("meta.description"), cardAlt: tMeta("ogAlt") }),
    // Indexable. Someone searching for a way to contact Heartfolio should
    // find this, and unlike the Studio it holds nothing session-scoped.
    robots: { index: true, follow: true },
  };
}

/**
 * §7c — general site feedback, tied to no order.
 *
 * A quiet page rather than a floating widget on every screen. The
 * invitation lives where the intent already exists: the footer, and the end
 * of the FAQ, where someone whose question was not answered is already
 * looking for a way to reach us. A persistent tab would compete with the
 * buy button on every page of an art-directed storefront.
 */
export default async function Page({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "FeedbackPage" });

  return (
    <>
      <SiteHeader />
      <main className="bg-page py-20 sm:py-28">
        <div className="mx-auto max-w-2xl px-5 sm:px-8">
          <h1 className="font-serif text-4xl leading-tight text-heading sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-body/75">{t("intro")}</p>
          <div className="mt-10">
            <GeneralFeedbackForm />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
