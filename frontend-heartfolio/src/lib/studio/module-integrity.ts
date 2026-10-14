import type { FieldSchema, ResolvedProductModuleConfig } from "@/types/studio";

/** Field ids are checked PER SCOPE. Top-level fields share one `values`
 * object, so their ids must be unique across the whole form (`out`). A
 * group's item fields are keys inside each item, so they only need to be
 * unique within that group: Reasons I Love You's `reasons[].text` and
 * `letterParagraphs[].text` do not collide, and flattening every scope into
 * one list reported them as a duplicate. A duplicate inside a group is
 * recorded in `nestedDuplicates`. */
function collectFieldIds(fields: FieldSchema[], out: string[], nestedDuplicates: string[]) {
  for (const field of fields) {
    out.push(field.id);
    if (field.type === "group") {
      const itemIds: string[] = [];
      collectFieldIds(field.itemFields, itemIds, nestedDuplicates);
      const duplicate = firstDuplicate(itemIds);
      if (duplicate) nestedDuplicates.push(duplicate);
    }
  }
}

function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/** Runs in development only. Never throws — a bad module should degrade
 * loudly in the console, not take down the Shell — but every finding
 * here is a real class of bug the architecture review identified as
 * having no safety net (e.g. `love-story-timeline`'s own `productId`
 * duplication would have been caught by an equivalent check before it
 * shipped). */
export function assertModuleIntegrity(productSlug: string, module: ResolvedProductModuleConfig) {
  if (process.env.NODE_ENV === "production") return;

  const warn = (message: string) => console.warn(`[Product Module: ${productSlug}] ${message}`);

  const fieldIds: string[] = [];
  const nestedDuplicates: string[] = [];
  for (const section of module.formSchema.sections) collectFieldIds(section.fields, fieldIds, nestedDuplicates);
  const duplicateField = firstDuplicate(fieldIds) ?? nestedDuplicates[0];
  if (duplicateField) {
    warn(`Duplicate field id "${duplicateField}" — field ids must be unique within their own section/group.`);
  }

  const axisIds = module.themes.axes.map((a) => a.id);
  const duplicateAxis = firstDuplicate(axisIds);
  if (duplicateAxis) {
    warn(`Duplicate theme axis id "${duplicateAxis}".`);
  }

  const knownFieldIds = new Set(fieldIds);
  const knownAxisIds = new Set(axisIds);
  for (const rule of module.pricing.rules) {
    for (const condition of rule.when ?? []) {
      const [scope, key] = condition.path.split(".");
      if (scope === "values" && key && !knownFieldIds.has(key)) {
        warn(`Pricing rule "${rule.id}" references values.${key}, which isn't a field in the schema.`);
      }
      if (scope === "theme" && key && !knownAxisIds.has(key)) {
        warn(`Pricing rule "${rule.id}" references theme.${key}, which isn't a theme axis.`);
      }
    }
  }
}
