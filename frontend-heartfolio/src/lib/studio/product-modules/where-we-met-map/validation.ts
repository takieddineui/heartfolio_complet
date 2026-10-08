import type { ValidationResult } from "@/types/studio";
import type { MapValues } from "./initial-state";

/** Covers what the generic engine structurally cannot: `required: true`
 * on the `coordinates` field is declared in the schema (so the Content
 * panel shows the required marker), but the generic validator's
 * `isEmpty()` only understands strings/arrays — an object value like
 * `{ lat: null, lng: null }` never reads as "empty" to it. So
 * required-ness *and* range-checking for coordinates both have to live
 * here rather than being free from the schema alone. See the SDK
 * limitation noted in `field-inputs.tsx` — this function is the
 * concrete case that limitation describes, not a workaround for it. */
export function validateMap(values: MapValues): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  const { lat, lng } = values.coordinates ?? { lat: null, lng: null };

  if (lat === null || lng === null) {
    errors["coordinates"] = { code: "locationRequired" };
  } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    errors["coordinates"] = { code: "invalidCoordinates" };
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
