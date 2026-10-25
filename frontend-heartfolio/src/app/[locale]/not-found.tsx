import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ConstellationMark } from "@/components/illustrations/constellation";

/** A route that matched and then called `notFound()`, inside the site's
 *  layout. Same words as the root 404 (`NotFound`), in the page's language
 *  (it was English on every locale until 25 Oct 2026). */
export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center bg-parchment px-6 text-center">
      <ConstellationMark className="h-8 w-40 opacity-70" />
      <h1 className="mt-8 font-serif text-3xl text-ink-navy sm:text-4xl">{t("title")}</h1>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-soft-charcoal/70">{t("body")}</p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/">{t("back")}</Link>
      </Button>
    </main>
  );
}
