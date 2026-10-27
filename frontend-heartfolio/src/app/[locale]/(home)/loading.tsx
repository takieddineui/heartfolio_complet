import { useTranslations } from "next-intl";
import { SkeletonBlock, SkeletonProductGrid, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";

/**
 * Homepage.
 *
 * IN THE `(home)` GROUP ON PURPOSE (27 Oct 2026). At `[locale]/loading.tsx`
 * this boundary wrapped EVERY page under `[locale]` that has no loading file
 * of its own, so they all streamed it and committed a 200 before their own
 * `notFound()` or error could set the status: an unknown `/live/<id>` was a
 * 200 "not found" page (a soft 404), and a gift recipient briefly saw the
 * shop's home skeleton. In the group it wraps the home page only.
 * `seo-status.test.ts` fails if a loading file comes back at `[locale]`.
 *
 * A NOTE ON WHY THIS IS A WHOLE-PAGE SKELETON, which is not ideal.
 *
 * Only the catalog-dependent sections need the catalog: the hero's phone,
 * the featured products and the occasion cards. The hero, how-it-works, FAQ and footer read from
 * message files and could render instantly. But the page is
 * `force-dynamic` with no Suspense boundary, so Next holds the entire
 * response until the catalog fetch resolves — and `loading.tsx` replaces
 * everything.
 *
 * A skeleton is still better than the blank page that was here before. The
 * genuinely better fix is to wrap only the catalog-dependent sections in
 * `<Suspense>`, so the hero streams immediately and only the grid waits.
 * That is a restructure of the page rather than a new file, which is why it
 * is noted here instead of done quietly.
 */
export default function Loading() {
  const t = useTranslations("Loading");
  return (
    <main className="bg-page">
      <SkeletonRegion label={t("site")}>
        {/* Hero — dark, full-bleed, two-column on desktop. */}
        <section className="bg-ink-navy py-24 sm:py-32">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="space-y-5">
              <SkeletonBlock className="h-4 w-32 bg-parchment/10" />
              <SkeletonBlock className="h-16 w-full bg-parchment/10" />
              <SkeletonBlock className="h-16 w-4/5 bg-parchment/10" />
              <SkeletonBlock className="h-4 w-3/4 bg-parchment/10" />
              <SkeletonBlock className="h-12 w-48 rounded-full bg-parchment/10" />
            </div>
            {/* The phone the four keepsakes play in. */}
            <SkeletonBlock className="mx-auto aspect-[600/1298] w-[min(62vw,250px)] rounded-[2.1rem] bg-parchment/10 lg:w-[240px]" />
          </div>
        </section>

        {/* Featured keepsakes — the first section that actually waits on data. */}
        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl space-y-10 px-5 sm:px-8">
            <div className="max-w-xl space-y-3">
              <SkeletonText width="w-28" />
              <SkeletonBlock className="h-10 w-2/3" />
            </div>
            <SkeletonProductGrid count={1} />
          </div>
        </section>
      </SkeletonRegion>
    </main>
  );
}
