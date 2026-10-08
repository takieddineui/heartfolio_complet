import type { ValidationResult } from "@/types/studio";
import type { TimelineValues } from "./initial-state";

/** Domain rule the generic schema validator can't express: milestone
 * dates should be unique — two events on the same date reads as a data
 * entry mistake in a *timeline* specifically, which is why this lives in
 * the module rather than the Shell's generic validator. The error is a
 * code ("duplicateDate"), not a string — resolved via
 * `messages.<locale>["validation.duplicateDate"]`. */
export function validateTimeline(values: TimelineValues): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  const seenDates = new Map<string, number>();

  values.events.forEach((event, index) => {
    if (!event.date) return;
    const firstIndex = seenDates.get(event.date);
    if (firstIndex !== undefined) {
      errors[`events.${index}.date`] = { code: "duplicateDate" };
    } else {
      seenDates.set(event.date, index);
    }
  });

  return { valid: Object.keys(errors).length === 0, errors };
}
