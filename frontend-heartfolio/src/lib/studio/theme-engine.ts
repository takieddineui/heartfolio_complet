import type { ThemeEngineConfig, ThemeSelections } from "@/types/studio";
import type { ThemeEngine } from "./extension-points";

export const themeEngine: ThemeEngine = {
  resolveTokens(config: ThemeEngineConfig, selections: ThemeSelections): Record<string, string> {
    const tokens: Record<string, string> = {};

    for (const axis of config.axes) {
      if (axis.kind === "range") {
        const raw = selections[axis.id];
        const value = typeof raw === "number" ? raw : axis.defaultValue;
        tokens[axis.cssVar] = axis.transform ? axis.transform(value) : String(value);
        continue;
      }

      const selectedId = (selections[axis.id] as string | undefined) ?? axis.defaultOptionId;
      const option = axis.options.find((o) => o.id === selectedId);
      if (option?.tokens) {
        Object.assign(tokens, option.tokens);
      }
    }

    return tokens;
  },
};

/** Computes the "smart default" suggestion for `targetAxisId` given that
 * `changedAxisId` was just set to `changedOptionId` — used by the generic
 * theme picker so choosing a palette can suggest a font/frame without
 * ever locking the person out of overriding it. Returns undefined when
 * the target axis has no default mapped for that change. */
export function resolveSmartDefault(
  config: ThemeEngineConfig,
  changedAxisId: string,
  changedOptionId: string,
  targetAxisId: string
): string | undefined {
  const target = config.axes.find((a) => a.id === targetAxisId);
  if (!target || target.kind === "range") return undefined;
  return target.defaultFor?.[`${changedAxisId}:${changedOptionId}`];
}
