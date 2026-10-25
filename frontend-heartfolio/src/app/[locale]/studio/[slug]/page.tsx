import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StudioShell } from "@/components/studio/studio-shell";
import { resolveProductEntry } from "@/hooks/use-product-entry";

interface StudioProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ project?: string }>;
}

/** "Song Poster · Studio — Heartfolio", in the page's language; every Studio
 *  showed the site's default title (25 Oct 2026). An unknown or hidden
 *  product never gets here: the proxy answers 404 first. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = resolveProductEntry(slug);
  if (!product) return {};
  const names = await getTranslations({ locale, namespace: `Products.${product.i18nKey}` });
  const t = await getTranslations({ locale, namespace: "PageTitles" });
  return { title: t("studio", { product: names("name") }) };
}

export default async function StudioProductPage({ params, searchParams }: StudioProductPageProps) {
  const { slug } = await params;
  const { project } = await searchParams;

  return <StudioShell productSlugOrId={slug} projectId={project} />;
}
