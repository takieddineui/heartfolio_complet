import type { ValidationResult } from "@/types/studio";
import type { GraduationValues } from "./initial-state";

/**
 * Domain rules the generic schema validator cannot express. "Is it filled
 * in" and "is it too long" are generic (and skip anything hidden by a
 * switched-off chapter); what is left is shape: an airport-style code is
 * exactly three letters, and the date is a real one in a sane range.
 *
 * The backend re-checks every one of these and is authoritative.
 */

const CODE = /^[A-Za-z]{3}$/;

function checkCode(value: unknown, key: string, errors: ValidationResult["errors"]) {
  if (typeof value === "string" && value.trim() !== "" && !CODE.test(value.trim())) {
    errors[key] = { code: "notThreeLetters" };
  }
}

export function validateGraduation(values: GraduationValues): ValidationResult {
  const errors: ValidationResult["errors"] = {};

  if (values.gradDate) {
    const parsed = new Date(`${values.gradDate}T12:00:00`);
    const year = parsed.getFullYear();
    if (Number.isNaN(parsed.valueOf()) || year < 1950 || year > 2100) {
      errors.gradDate = { code: "invalidDate" };
    }
  }

  checkCode(values.flightFromCode, "flightFromCode", errors);
  checkCode(values.flightToCode, "flightToCode", errors);

  if (values.showPath) {
    values.stops?.forEach((stop, i) => checkCode(stop.code, `stops.${i}.code`, errors));
  }
  if (values.showGoals) {
    values.goals?.forEach((goal, i) => checkCode(goal.code, `goals.${i}.code`, errors));
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
