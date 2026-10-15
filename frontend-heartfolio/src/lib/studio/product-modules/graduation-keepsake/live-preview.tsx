"use client";

import { experienceFromStudio } from "@/components/live-graduation/experience-data";
import { GraduationKeepsake } from "@/components/live-graduation/graduation-keepsake";
import type { ThemeSelections } from "@/types/studio";
import type { GraduationValues } from "./initial-state";

/**
 * The Studio's preview: the SAME component the purchased `/live/<id>` page
 * renders, fed from the form instead of the backend. Keyed by journey, so
 * switching journeys starts the new one from its opening (and closes the old
 * one's sounds and voice). No share link exists before purchase, so the share
 * button is shown, inert.
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
  const data = experienceFromStudio(values, themeSelections);
  return <GraduationKeepsake key={data.journey} data={data} locale={locale} fill="container" shareUrl={null} />;
}
