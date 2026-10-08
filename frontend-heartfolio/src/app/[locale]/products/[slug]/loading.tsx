import { SkeletonBlock, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";

/**
 * Product page. The two-column hero is the part worth mirroring: the 4:5
 * artwork panel is the largest element on the page, and reserving its
 * space is what stops the whole page jumping when it arrives.
 */
export default function Loading() {
  return (
    <main className="bg-page">
      <SkeletonRegion label="Loading this keepsake">
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SkeletonText width="w-48" />
            <div className="mt-10 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
              <div className="space-y-5">
                <SkeletonBlock className="h-14 w-4/5" />
                <SkeletonText width="w-full" />
                <SkeletonText width="w-5/6" />
                <div className="flex gap-2 pt-2">
                  <SkeletonBlock className="h-7 w-24 rounded-full" />
                  <SkeletonBlock className="h-7 w-28 rounded-full" />
                </div>
                <SkeletonBlock className="h-12 w-44 rounded-full" />
              </div>
              <SkeletonBlock className="aspect-[4/5] w-full rounded-[var(--radius-xl)]" />
            </div>
          </div>
        </section>
      </SkeletonRegion>
    </main>
  );
}
