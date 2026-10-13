"use client";

import { Download, Globe, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/studio/ui/card";
import { useProductState } from "@/lib/studio/product-state-context";
import { resolveExportTargets } from "@/types/studio";
import { PanelPlaceholder } from "./panel-placeholder";

/**
 * What the customer's keepsake will be delivered as.
 *
 * The download buttons here used to rasterize the canvas in the browser and
 * hand over the finished files — before payment, to anyone who opened the
 * Studio. They are now a list of what each format is, and the real files
 * come from Django's entitlement-gated delivery endpoint after a confirmed
 * payment (Step 12).
 *
 * Same Card, same icon, same rows, same type scale; the rows are no longer
 * buttons because there is nothing to click yet.
 */
export function ExportSection() {
  const t = useTranslations("Studio.panels.export");
  const { session, t: moduleT, themeSelections } = useProductState();
  const { delivery } = session.module;

  if (delivery.mode === "hosted") {
    return (
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2.5">
          <Globe className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
          <h2 className="text-[15px] font-medium text-heading">{t("title")}</h2>
        </div>
        <p className="text-sm text-body/60">
          {delivery.hosted.description ?? "This product is delivered as a hosted link, not a download."}
        </p>
      </Card>
    );
  }

  if (delivery.mode === "interactive") {
    return (
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
          <h2 className="text-[15px] font-medium text-heading">{t("title")}</h2>
        </div>
        <p className="text-sm text-body/60">
          {delivery.interactive.descriptionKey
            ? moduleT(delivery.interactive.descriptionKey)
            : (delivery.interactive.description ?? "This product stays interactive rather than being exported.")}
        </p>
      </Card>
    );
  }

  const resolvedTargets = resolveExportTargets(delivery.export, themeSelections);
  const targets = Object.entries(resolvedTargets);
  const hasFormats = targets.some(([, formats]) => formats.length > 0);

  if (delivery.export.hideCustomerFacingList) return null;

  if (!hasFormats) {
    return <PanelPlaceholder icon={Download} title={t("title")} description={t("description")} />;
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <Download className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
        <h2 className="text-[15px] font-medium text-heading">{t("title")}</h2>
      </div>
      <div className="space-y-2">
        {targets.map(([targetId, formats]) =>
          formats.map((format) => (
            <div
              key={`${targetId}:${format.id}`}
              className="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-subtle px-3 py-2 text-sm text-heading"
            >
              <span>{moduleT(format.label)}</span>
              <span className="text-xs text-body/50">{`${format.width}×${format.height}`}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
