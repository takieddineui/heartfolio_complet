import { useTranslations } from "next-intl";
import { SkeletonBlock, SkeletonProductGrid, SkeletonRegion } from "@/components/ui/skeleton";

/** The product chooser. Same card grid as the collection. */
export default function Loading() {
  const t = useTranslations("Loading");
  return (
    <main className="bg-page">
      <SkeletonRegion label={t("page")}>
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SkeletonBlock className="h-12 w-2/3 max-w-lg" />
            <div className="mt-12">
              <SkeletonProductGrid />
            </div>
          </div>
        </section>
      </SkeletonRegion>
    </main>
  );
}
