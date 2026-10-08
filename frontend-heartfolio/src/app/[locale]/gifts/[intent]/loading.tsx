import { SkeletonBlock, SkeletonProductGrid, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";

/** Gift-intent landing page: centred heading, then the same grid. */
export default function Loading() {
  return (
    <main className="bg-page">
      <SkeletonRegion label="Loading">
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl space-y-5 px-5 text-center sm:px-8">
            <SkeletonBlock className="mx-auto h-12 w-3/4" />
            <SkeletonText width="w-full" />
            <SkeletonText width="w-5/6" />
          </div>
        </section>
        <div className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <SkeletonProductGrid />
        </div>
      </SkeletonRegion>
    </main>
  );
}
