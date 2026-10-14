import type { FieldSchema, FormSchemaConfig, ThemeSelections, ValidationResult } from "@/types/studio";
import { evaluateConditions } from "./conditions";
import type { FormEngine } from "./extension-points";

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Walks a schema (including nested group item fields) and checks
 * `required`/`maxLength`/group `minItems` against a values object keyed
 * by field id. Errors are codes + params, not strings — see
 * `types/studio.ts#ValidationError` and `lib/studio/i18n.ts` for why. A
 * module's own `validate()` layers domain rules on top of this generic
 * floor.
 *
 * A field whose `visibleWhen` fails is skipped entirely (its `required`,
 * its `maxLength`, and for a group its `minItems` and every item):
 * `GenericForm` hides it, and a hidden field that still failed validation
 * left the Studio blocked with nothing on screen to fix. The conditions are
 * evaluated against the same `{ values, theme }` context the form draws
 * with: the whole form for a top-level field, the item for a group's
 * fields. */
function validateFields(
  fields: FieldSchema[],
  values: Record<string, unknown>,
  errors: ValidationResult["errors"],
  theme: ThemeSelections
) {
  for (const field of fields) {
    if (!evaluateConditions(field.visibleWhen, { values, theme })) continue;

    const value = values[field.id];

    if (field.type === "group") {
      const items = Array.isArray(value) ? value : [];
      if (items.length < field.minItems) {
        errors[field.id] = { code: "minItems", params: { minItems: field.minItems } };
      }
      items.forEach((item, index) => {
        const itemValues = (item ?? {}) as Record<string, unknown>;
        const itemErrors: ValidationResult["errors"] = {};
        validateFields(field.itemFields, itemValues, itemErrors, theme);
        for (const [key, error] of Object.entries(itemErrors)) {
          errors[`${field.id}.${index}.${key}`] = error;
        }
      });
      continue;
    }

    if (field.required && isEmpty(value)) {
      errors[field.id] = { code: "required", params: { label: field.label } };
      continue;
    }

    if ((field.type === "text" || field.type === "textarea") && field.maxLength && typeof value === "string") {
      if (value.length > field.maxLength) {
        errors[field.id] = { code: "maxLength", params: { label: field.label, maxLength: field.maxLength } };
      }
    }
  }
}

export const formEngine: FormEngine = {
  validate(schema: FormSchemaConfig, values: unknown, themeSelections: ThemeSelections = {}): ValidationResult {
    const errors: ValidationResult["errors"] = {};
    const valuesObj = (values ?? {}) as Record<string, unknown>;
    for (const section of schema.sections) {
      validateFields(section.fields, valuesObj, errors, themeSelections);
    }
    return { valid: Object.keys(errors).length === 0, errors };
  },
};

/** Builds a freshly-added group item's starting values from its
 * `itemFields`' `defaultValue`s (falling back to `undefined` for fields
 * that don't declare one) — the generic-form gap the architecture
 * review flagged: new items previously always started as `{}`. */
export function createGroupItemDefaults(itemFields: FieldSchema[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of itemFields) {
    if ("defaultValue" in field && field.defaultValue !== undefined) {
      defaults[field.id] = field.defaultValue;
    }
  }
  return defaults;
}
