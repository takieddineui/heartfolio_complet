import { redirect } from "@/i18n/navigation";

interface StudioQueryEntryProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string; project?: string }>;
}

/**
 * Supports the `/studio?product=moon-phase` entry shape from the brief by
 * normalizing it to the canonical `/studio/moon-phase` route — one route
 * owns rendering, this one only redirects.
 */
export default async function StudioQueryEntry({ params, searchParams }: StudioQueryEntryProps) {
  const { locale } = await params;
  const { product, project } = await searchParams;

  // No productId at all — go straight to the "not found" product slug so
  // the same beautiful error page handles it, rather than a bare 404.
  const slug = product ?? "not-found";
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  redirect({ href: `/studio/${slug}${query}`, locale });
}
