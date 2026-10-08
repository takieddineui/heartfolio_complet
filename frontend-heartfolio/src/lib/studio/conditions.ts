import type { Condition } from "@/types/studio";

function readPath(context: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

export function evaluateCondition(condition: Condition, context: Record<string, unknown>): boolean {
  const actual = readPath(context, condition.path);
  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "gt":
      return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "gte":
      return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "lt":
      return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "lte":
      return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
    case "includes":
      return Array.isArray(actual) && actual.includes(condition.value);
    default:
      return false;
  }
}

/** AND-combines a list of conditions; an empty/undefined list is always
 * true (used for "always applies" pricing rules and "always visible"
 * fields/axes alike). */
export function evaluateConditions(conditions: Condition[] | undefined, context: Record<string, unknown>): boolean {
  return (conditions ?? []).every((c) => evaluateCondition(c, context));
}
