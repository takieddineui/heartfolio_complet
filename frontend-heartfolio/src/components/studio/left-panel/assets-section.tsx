"use client";

import { ImagePlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/studio/ui/card";
import { useProductState } from "@/lib/studio/product-state-context";
import type { FieldSchema } from "@/types/studio";
import { mediaDisplayName } from "@/lib/studio/media-names";
import { PanelPlaceholder } from "./panel-placeholder";

interface UploadedMedia {
  url: string;
  mimeType: string;
  /** Absent once saved: the server keeps no filename (`mediaDisplayName`). */
  filename?: string;
}

const MEDIA_TYPES = new Set(["image", "gallery", "audio", "video", "file"]);

/** Generic walk over any schema (including group item fields) collecting
 * every uploaded media item currently sitting in a media-typed field.
 * Works for any Product Module's schema — the Shell never needs to know
 * a product has "milestone photos" specifically, only that some field
 * somewhere is one of the media types. */
function collectMedia(fields: FieldSchema[], values: Record<string, unknown>): UploadedMedia[] {
  const items: UploadedMedia[] = [];
  for (const field of fields) {
    if (MEDIA_TYPES.has(field.type)) {
      const v = values[field.id];
      if (Array.isArray(v)) items.push(...(v as UploadedMedia[]));
      else if (v && typeof v === "object" && "url" in v) items.push(v as UploadedMedia);
    } else if (field.type === "group") {
      const groupItems = Array.isArray(values[field.id]) ? (values[field.id] as Record<string, unknown>[]) : [];
      for (const item of groupItems) items.push(...collectMedia(field.itemFields, item));
    }
  }
  return items;
}

export function AssetsSection() {
  const t = useTranslations("Studio.panels.assets");
  const locale = useLocale();
  const { session, values } = useProductState();
  const media = session.module.formSchema.sections.flatMap((s) => collectMedia(s.fields, values));

  if (media.length === 0) {
    return <PanelPlaceholder icon={ImagePlus} title={t("title")} description={t("description")} />;
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <ImagePlus className="h-4 w-4 text-champagne-gold" strokeWidth={1.75} />
        <h2 className="text-[15px] font-medium text-heading">{t("title")}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {media.map((item, i) =>
          item.mimeType?.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={item.url} alt="" className="h-14 w-14 rounded-[var(--radius-sm)] object-cover" />
          ) : (
            <div
              key={i}
              className="flex h-14 max-w-[9rem] items-center rounded-[var(--radius-sm)] border border-subtle bg-page px-2 text-xs text-body/70"
            >
              <span className="truncate">{mediaDisplayName(item, i, locale)}</span>
            </div>
          )
        )}
      </div>
    </Card>
  );
}
