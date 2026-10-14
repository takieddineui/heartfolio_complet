"use client";

import { ReasonsKeepsake } from "@/components/live-reasons/reasons-keepsake";
import { experienceFromStudio } from "@/components/live-reasons/experience-data";
import type { ThemeSelections } from "@/types/studio";
import type { ReasonsValues } from "./initial-state";

/**
 * The Studio's preview of the gift: the SAME component the purchased
 * `/live/<id>` page renders, fed from the form instead of the backend. Keyed
 * by gift, so switching gifts starts the new one from the beginning (and
 * closes the old one's audio) rather than carrying opened reasons across.
 * No share link exists before purchase, so the share button is shown inert.
 */
export function ReasonsLivePreview({
  values,
  themeSelections,
  locale,
}: {
  values: ReasonsValues;
  themeSelections: ThemeSelections;
  locale: string;
}) {
  const data = experienceFromStudio(values, themeSelections);
  return <ReasonsKeepsake key={data.gift} data={data} locale={locale} fill="container" shareUrl={null} />;
}
