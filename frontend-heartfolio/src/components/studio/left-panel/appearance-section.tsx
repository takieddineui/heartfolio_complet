"use client";

import { Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/studio/ui/card";
import { useProductState } from "@/lib/studio/product-state-context";
import { ThemePicker } from "@/components/studio/generic-form/theme-picker";
import { PanelPlaceholder } from "./panel-placeholder";

export function AppearanceSection() {
  const t = useTranslations("Studio.panels.appearance");
  const { session, values, themeSelections, setThemeSelections, t: moduleT } = useProductState();

  if (session.module.themes.axes.length === 0) {
    return <PanelPlaceholder icon={Palette} title={t("title")} description={t("description")} />;
  }

  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center gap-2.5">
        <Palette className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
        <h2 className="text-[15px] font-medium text-heading">{t("title")}</h2>
      </div>
      <ThemePicker
        config={session.module.themes}
        values={values}
        selections={themeSelections}
        onChange={setThemeSelections}
        t={moduleT}
      />
    </Card>
  );
}
