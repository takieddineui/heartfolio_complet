import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ConstellationMark } from "@/components/illustrations/constellation";

export default function NotFound() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center bg-parchment px-6 text-center">
      <ConstellationMark className="h-8 w-40 opacity-70" />
      <h1 className="mt-8 font-serif text-3xl text-ink-navy sm:text-4xl">
        This page wandered off.
      </h1>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-soft-charcoal/70">
        Let&rsquo;s find your way back — there&rsquo;s still a moment worth keeping.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/">Back to Heartfolio</Link>
      </Button>
    </main>
  );
}
