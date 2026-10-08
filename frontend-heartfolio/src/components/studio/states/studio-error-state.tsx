"use client";

import { CompassIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/studio/ui/button";

interface StudioErrorStateProps {
  /** "not-found" (unknown product), "error" (module failed to load), or
   * "project-unavailable" (the Project Save/Load Engine isn't implemented
   * yet) — same visual treatment, different copy. */
  variant: "not-found" | "error" | "project-unavailable";
}

export function StudioErrorState({ variant }: StudioErrorStateProps) {
  const t = useTranslations(`Studio.errors.${variant}`);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-page px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-[var(--shadow-lift)]">
        <CompassIcon className="h-7 w-7 text-champagne-gold" strokeWidth={1.5} />
      </div>
      <div className="max-w-md space-y-2 animate-drift-in">
        <h1 className="font-serif text-2xl text-heading">{t("title")}</h1>
        <p className="text-[15px] text-body/70">{t("description")}</p>
      </div>
      <Button asChild variant="secondary">
        <Link href="/">{t("cta")}</Link>
      </Button>
    </div>
  );
}
