"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/studio/ui/button";
import { useProductState } from "@/lib/studio/product-state-context";

export function ContinueButton() {
  const t = useTranslations("Studio.panels.continue");
  const { validation, openCheckout } = useProductState();

  return (
    <Button
      size="lg"
      className="w-full"
      disabled={!validation.valid}
      title={!validation.valid ? t("disabledHint") : undefined}
      onClick={openCheckout}
    >
      {t("cta")}
    </Button>
  );
}
