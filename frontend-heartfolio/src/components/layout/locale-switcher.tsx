"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Each language is labelled in its own language — a French speaker
 * scanning an Arabic page should still recognise "Français". */
const LABELS: Record<string, { short: string; full: string }> = {
  en: { short: "EN", full: "English" },
  fr: { short: "FR", full: "Français" },
  ar: { short: "AR", full: "العربية" },
};

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Persist an explicit language choice. Module scope on purpose — writing
 * to `document.cookie` is a side effect on an external system, not
 * something to do inside a component body. */
function rememberLocale(locale: string) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  /**
   * An explicit choice is a *preference*, not a one-off. It is persisted
   * to the same cookie `proxy.ts` reads, so a later visit to a bare URL
   * resolves to this language instead of re-running browser detection
   * (§22). `localeDetection` is off in next-intl, so nothing else writes
   * this cookie — this is the only place a user's choice is recorded.
   *
   * Theme is untouched here, on purpose: locale and theme are independent
   * (§23). See the note in `theme-provider.tsx`.
   */
  const choose = (next: string) => {
    rememberLocale(next);
    router.replace(pathname, { locale: next as (typeof routing.locales)[number] });
  };

  return (
    <div
      className={`flex items-center rounded-full border border-subtle p-0.5 text-xs font-medium ${className ?? ""}`}
      role="group"
      aria-label="Select language"
    >
      {routing.locales.map((loc) => (
        <button
          key={loc}
          type="button"
          lang={loc}
          onClick={() => choose(loc)}
          aria-pressed={locale === loc}
          aria-label={LABELS[loc]?.full ?? loc}
          className={`rounded-full px-2.5 py-1.5 transition-colors ${
            locale === loc ? "bg-heading text-page" : "text-body/70 hover:text-heading"
          }`}
        >
          {LABELS[loc]?.short ?? loc.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
