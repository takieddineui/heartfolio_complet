import type { ProductModuleConfig } from "@/types/studio";
import { mapSchema } from "./schema";
import { mapThemes } from "./themes";
import { WhereWeMetMapRenderer } from "./renderer";
import { mapPricing } from "./pricing";
import { mapExports } from "./exports";
import { validateMap } from "./validation";
import { mapMessages } from "./messages";
import { createInitialState, createInitialThemeSelections, type MapValues } from "./initial-state";
import { getFormatPreset } from "@/lib/studio/format-presets";

export const whereWeMetMapModule: ProductModuleConfig<MapValues> = {
  formSchema: mapSchema,
  themes: mapThemes,
  renderer: {
    kind: "component",
    component: WhereWeMetMapRenderer,
    intrinsicSize: (_values, themeSelections) => {
      const preset = getFormatPreset(themeSelections.format as string | undefined);
      return { width: preset.width, height: preset.height };
    },
  },
  pricing: mapPricing,
  delivery: { mode: "export", export: mapExports },
  messages: mapMessages,
  createInitialState,
  createInitialThemeSelections,
  validate: validateMap,
};
