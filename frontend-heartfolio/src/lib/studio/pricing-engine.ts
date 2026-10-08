import type { PricingAction, PricingConfig, PricingResult } from "@/types/studio";
import type { PricingEngine } from "./extension-points";
import { evaluateConditions } from "./conditions";

function applyAction(action: PricingAction, runningCents: number): number {
  switch (action.type) {
    case "setBase":
      return action.amountCents ?? runningCents;
    case "addFixed":
      return runningCents + (action.amountCents ?? 0);
    case "addPercent":
      return runningCents + Math.round(runningCents * ((action.percent ?? 0) / 100));
    case "applyCoupon":
      return runningCents + (action.amountCents ?? 0);
    default:
      return runningCents;
  }
}

export const pricingEngine: PricingEngine = {
  computeTotal(config: PricingConfig, context: { values: unknown; theme: Record<string, string | number> }): PricingResult {
    const evalContext = { values: context.values ?? {}, theme: context.theme ?? {} } as Record<string, unknown>;
    let totalCents = config.basePriceCents;
    const lineItems: PricingResult["lineItems"] = [];

    for (const rule of config.rules) {
      if (!evaluateConditions(rule.when, evalContext)) continue;

      const before = totalCents;
      for (const action of rule.then) {
        totalCents = applyAction(action, totalCents);
      }
      const delta = totalCents - before;
      // `label` here is still the translation *key* — PricingSummary
      // resolves it to text before building what it actually displays;
      // this result is locale-agnostic on purpose.
      if (delta !== 0 && rule.label) {
        lineItems.push({ ruleId: rule.id, label: rule.label, deltaCents: delta });
      }
    }

    return { totalCents, currency: config.currency, lineItems };
  },
};

/** `locale` drives *formatting* (grouping, symbol placement); `currency`
 * is the module's own pricing decision and travels with the amount. */
export function formatCents(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
