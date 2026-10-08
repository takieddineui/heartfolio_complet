"use client";

import { WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";

export function PreviewEmptyState() {
  const t = useTranslations("Studio.preview");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-subtle bg-card/40 p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card shadow-[var(--shadow-whisper)] animate-float-slow">
        <WandSparkles className="h-6 w-6 text-champagne-gold" strokeWidth={1.5} />
      </div>
      <div className="max-w-sm space-y-1.5">
        <p className="font-serif text-lg text-heading">{t("emptyTitle")}</p>
        <p className="text-sm text-body/70">{t("emptySubtitle")}</p>
      </div>
    </div>
  );
}
