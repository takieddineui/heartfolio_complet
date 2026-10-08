"use client";

import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/studio/ui/card";
import { useProductState } from "@/lib/studio/product-state-context";
import { GenericForm } from "@/components/studio/generic-form/generic-form";
import { PanelPlaceholder } from "./panel-placeholder";

export function ContentSection() {
  const t = useTranslations("Studio.panels.content");
  const { session, values, themeSelections, setValues, validation } = useProductState();

  if (session.module.formSchema.sections.length === 0) {
    return <PanelPlaceholder icon={PenLine} title={t("title")} description={t("description")} />;
  }

  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center gap-2.5">
        <PenLine className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
        <h2 className="text-[15px] font-medium text-heading">{t("title")}</h2>
      </div>
      <GenericForm
        schema={session.module.formSchema}
        values={values}
        themeSelections={themeSelections}
        errors={validation.errors}
        onChange={(fieldId, value) => setValues((prev) => ({ ...prev, [fieldId]: value }))}
      />
    </Card>
  );
}
