import type { ProductModuleConfig } from "@/types/studio";
import { graduationSchema } from "./schema";
import { graduationThemes } from "./themes";
import { graduationPricing } from "./pricing";
import { graduationExports } from "./exports";
import { graduationMessages } from "./messages";
import { createInitialState, createInitialThemeSelections, type GraduationValues } from "./initial-state";
import { validateGraduation } from "./validation";
import { GraduationLivePreview } from "./live-preview";
import { GraduationPreviewPlaceholder } from "./preview-placeholder";

/**
 * Graduation Keepsake - a LIVE-ONLY product.
 *
 * Its one deliverable is the hosted page, so there is no poster to draw:
 * `previewModes: ["live"]` makes the Live tab the only preview (the Shell draws
 * no tab strip for a single mode) and `renderer` exists only to satisfy the
 * type - `GraduationPreviewPlaceholder` is never mounted while "live" is the
 * only mode. `delivery.mode: "interactive"` is what the Export panel reads.
 *
 * More packs later (a printable, wallpapers) are additive: add `"flat"` /
 * `"framed"` to `previewModes`, give `renderer` a real component, and list the
 * formats in `exports.ts`.
 */
export const graduationKeepsakeModule: ProductModuleConfig<GraduationValues> = {
  formSchema: graduationSchema,
  themes: graduationThemes,
  renderer: {
    kind: "component",
    component: GraduationPreviewPlaceholder,
    intrinsicSize: () => ({ width: 390, height: 844 }),
  },
  previewModes: ["live"],
  pricing: graduationPricing,
  delivery: {
    mode: "interactive",
    interactive: { descriptionKey: "delivery.interactive" },
  },
  messages: graduationMessages,
  createInitialState,
  createInitialThemeSelections,
  validate: validateGraduation,
  livePreview: { component: GraduationLivePreview },
};

export { graduationExports };
