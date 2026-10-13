"use client";

import { LiveGraduation } from "@/components/live-graduation/live-graduation";
import type { ThemeSelections } from "@/types/studio";
import type { GraduationValues } from "./initial-state";

/**
 * The Studio's Live tab. A thin adapter and nothing more: `LiveGraduation` is
 * the exact component the purchased `/live/<id>` page renders, and it needs
 * only `values`, `themeSelections` and a locale - no order, no entitlement.
 * The one difference is where media URLs come from: Studio state holds
 * `{ url, assetId? }` (a local blob preview until checkout uploads it) and
 * the live payload holds `{ url }`, so the same component reads `.url` from
 * both. Nothing is uploaded or fetched to show this.
 */
export function GraduationLivePreview({
  values,
  themeSelections,
  locale,
}: {
  values: GraduationValues;
  themeSelections: ThemeSelections;
  locale: string;
}) {
  return (
    <LiveGraduation
      values={values as unknown as Record<string, unknown>}
      themeSelections={themeSelections}
      locale={locale}
      embedded
    />
  );
}
