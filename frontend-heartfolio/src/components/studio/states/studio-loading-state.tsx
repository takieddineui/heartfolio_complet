"use client";

import { useTranslations } from "next-intl";

export function StudioLoadingState() {
  const t = useTranslations("Studio.loading");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-page px-6 text-center">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border-2 border-subtle" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-champagne-gold [animation-duration:1.1s]" />
      </div>
      <div className="animate-drift-in space-y-1.5">
        <p className="font-serif text-xl text-heading">{t("title")}</p>
        <p className="text-[15px] text-body/70">{t("subtitle")}</p>
      </div>
    </div>
  );
}
