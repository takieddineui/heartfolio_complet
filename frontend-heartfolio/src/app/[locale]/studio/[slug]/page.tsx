import { StudioShell } from "@/components/studio/studio-shell";

interface StudioProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ project?: string }>;
}

export default async function StudioProductPage({ params, searchParams }: StudioProductPageProps) {
  const { slug } = await params;
  const { project } = await searchParams;

  return <StudioShell productSlugOrId={slug} projectId={project} />;
}
