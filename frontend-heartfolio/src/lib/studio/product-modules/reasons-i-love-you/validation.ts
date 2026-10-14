import type { ValidationResult } from "@/types/studio";
import type { ReasonsValues } from "./initial-state";

/**
 * Rules the shared validator cannot express: the letter's fields are
 * required only while the letter is on (see `schema.ts`). The backend
 * enforces the same rule (`data.py`).
 */
export function validateReasons(values: ReasonsValues): ValidationResult {
  const errors: ValidationResult["errors"] = {};

  if (values.letterEnabled) {
    if (!values.letterGreeting?.trim()) errors.letterGreeting = { code: "letterGreetingRequired" };
    const paragraphs = Array.isArray(values.letterParagraphs) ? values.letterParagraphs : [];
    if (paragraphs.length === 0) errors.letterParagraphs = { code: "letterParagraphsRequired" };
    paragraphs.forEach((paragraph, index) => {
      if (!paragraph?.text?.trim()) errors[`letterParagraphs.${index}.text`] = { code: "letterParagraphEmpty" };
    });
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
