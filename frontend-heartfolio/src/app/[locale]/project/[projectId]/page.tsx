import type { Metadata } from "next";
import { StudioShell } from "@/components/studio/studio-shell";
import { noindexMetadata } from "@/lib/seo";

/** A customer's saved draft: crawlable, never indexed, its own canonical. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; projectId: string }> }): Promise<Metadata> {
  const { locale, projectId } = await params;
  return noindexMetadata(locale, `/project/${projectId}`, { follow: false });
}

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ product?: string }>;
}

/**
 * `/project/:id` — resumes a saved project.
 *
 * The product is no longer resolved here. It is resolved in the browser by
 * `useStudioSession`, because loading a project requires the guest's
 * session cookie and that identity deliberately lives only in the browser
 * (see lib/api/client.ts). Resolving it server-side meant this route had to
 * forward the customer's cookie from a Server Component — a second place
 * speaking for the customer, for no gain.
 *
 * `?product=` is still accepted as an explicit hint, but is now only a
 * fallback: the saved project itself is authoritative about its product.
 */
export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { projectId } = await params;
  const { product } = await searchParams;

  return <StudioShell productSlugOrId={product} projectId={projectId} />;
}
