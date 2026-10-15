import type { ThemeSelections, ValidationResult } from "@/types/studio";
import type { GraduationValues } from "./initial-state";
import { journeyOrDefault } from "./journeys";
import { GRADUATION_LIMITS as L } from "./limits";

const YEAR = /^\d{4}$/;
const CODE = /^[A-Za-z]{3}$/;

/** A real calendar date in `YYYY-MM-DD` (the date input's own format). */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Rules the shared form engine cannot express. The backend enforces the same
 * (`data.py`). Every rule here applies only to what the customer can see:
 * a chapter that is off is skipped, and the airport codes count only on the
 * airline journey (the only one that shows them).
 */
export function validateGraduation(values: GraduationValues, themeSelections: ThemeSelections = {}): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  const airline = journeyOrDefault(themeSelections.journey) === "airline";

  if (values.gradYear && !YEAR.test(values.gradYear.trim())) errors.gradYear = { code: "year" };
  if (values.gradDate && !isDate(values.gradDate)) errors.gradDate = { code: "date" };

  const code = (key: string, value: string | undefined) => {
    if (airline && value?.trim() && !CODE.test(value.trim())) errors[key] = { code: "airportCode" };
  };
  if (values.pathEnabled) (values.stops ?? []).forEach((stop, i) => code(`stops.${i}.code`, stop?.code));
  if (values.goalsEnabled) (values.goals ?? []).forEach((goal, i) => code(`goals.${i}.code`, goal?.code));
  code("flightFromCode", values.flightFromCode);
  code("flightToCode", values.flightToCode);

  // Five voice messages and five drawings in the WHOLE keepsake: the sixth and
  // later are flagged where they are, so the customer sees which to remove.
  if (values.messagesEnabled) {
    let voices = 0;
    let drawings = 0;
    (values.messageGroups ?? []).forEach((group, g) => {
      (group?.people ?? []).forEach((person, p) => {
        if (person?.voice && ++voices > L.maxVoices) {
          errors[`messageGroups.${g}.people.${p}.voice`] = { code: "tooManyVoices", params: { max: L.maxVoices } };
        }
        if (person?.drawing && ++drawings > L.maxDrawings) {
          errors[`messageGroups.${g}.people.${p}.drawing`] = { code: "tooManyDrawings", params: { max: L.maxDrawings } };
        }
      });
    });
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
