import { setRequestLocale } from "next-intl/server";
import { getCatalogProducts } from "@/lib/products/catalog-server";
import { CreatePageContent } from "@/components/create/create-page-content";

/**
 * Rendered per request so the product grid reflects Django's real
 * availability and prices rather than a build-time snapshot — same reasoning
 * as the product detail route.
 *
 * The page itself became a Server Component purely to do that fetch; every
 * piece of UI still lives in `CreatePageContent`, which is the original
 * client component moved out of this file unchanged. Nothing about the
 * layout, the grid, the cards or the Continue button was touched.
 */
export const dynamic = "force-dynamic";

export default async function CreatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { products } = await getCatalogProducts();

  return <CreatePageContent products={products} />;
}
