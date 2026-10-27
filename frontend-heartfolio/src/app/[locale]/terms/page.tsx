import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { LegalPage } from "@/components/legal/legal-page";
import { buildAlternates, pageShareMetadata } from "@/lib/seo";

const KEY = "terms" as const;
const PATH = "/terms";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: `Legal.${KEY}` });
  const tMeta = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: buildAlternates(locale, PATH),
    // Its own share title and address, with the site's card (`seo.ts`).
    ...pageShareMetadata(locale, PATH, { title: t("meta.title"), description: t("meta.description"), cardAlt: tMeta("ogAlt") }),
    // Policy pages should be indexable — Paddle's review and customers
    // both need to reach them from search, not only from the footer.
    robots: { index: true, follow: true },
  };
}

export default async function Page({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <SiteHeader />
      <LegalPage legalKey={KEY} />
      <SiteFooter />
    </>
  );
}
