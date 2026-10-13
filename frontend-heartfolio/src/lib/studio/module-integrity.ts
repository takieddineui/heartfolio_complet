import type { FieldSchema, ResolvedProductModuleConfig } from "@/types/studio";

/** Every field id in `fields`, walking into groups. Ids are collected PER
 * SCOPE - the form's top level, then each group's own item fields on their
 * own - because that is what the message below promises and what the form
 * needs: an item field's id is a key inside THAT item (`stops[0].code` and
 * `goals[0].code` do not collide), whereas two top-level fields sharing an id
 * would overwrite each other. Flattening everything into one list reported the
 * legitimate case as a bug. Returns the top-level ids and records any
 * duplicate found inside a nested scope. */
function collectFieldIds(fields: FieldSchema[], out: string[], duplicates: string[] = []): string[] {
  for (const field of fields) {
    out.push(field.id);
    if (field.type === "group") {
      const nestedIds: string[] = [];
      collectFieldIds(field.itemFields, nestedIds, duplicates);
      const inner = firstDuplicate(nestedIds);
      if (inner) duplicates.push(inner);
    }
  }
  return duplicates;
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
