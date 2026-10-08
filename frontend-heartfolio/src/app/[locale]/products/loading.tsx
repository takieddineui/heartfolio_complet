import { SkeletonBlock, SkeletonProductGrid, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";

/** Collection page. Mirrors the heading block and the three-column grid. */
export default function Loading() {
  return (
    <main className="bg-page">
      <SkeletonRegion label="Loading the collection">
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl space-y-4">
              <SkeletonText width="w-32" />
              <SkeletonBlock className="h-12 w-3/4" />
              <SkeletonText width="w-full" />
            </div>
            <div className="mt-14">
              <SkeletonProductGrid />
            </div>
          </div>
        </section>
      </SkeletonRegion>
    </main>
  );
}
