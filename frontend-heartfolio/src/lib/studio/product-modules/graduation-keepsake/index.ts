import type { ProductModuleConfig } from "@/types/studio";
import { createInitialState, createInitialThemeSelections, type GraduationValues } from "./initial-state";
import { GraduationLivePreview } from "./live-preview";
import { graduationMessages } from "./messages";
import { graduationPricing } from "./pricing";
import { graduationSchema } from "./schema";
import { graduationThemes } from "./themes";
import { validateGraduation } from "./validation";

/**
 * GRADUATION KEEPSAKE: live-only, like Reasons I Love You. No print, no
 * renderer, no file: the customer buys the hosted page. One story told as one
 * of five journeys (`journeys.ts`), chosen in the Studio.
 *
 * So the preview is `kind: "live"` (the Studio mounts `livePreview` full-pane)
 * and delivery is `"hosted"` (the sidebar says it is a link, not a download).
 *
 * OUT OF v1, DELIBERATELY, and not stubbed: the graduate's reply and quick
 * reactions, any report back to the creator (started, finished), a collection
 * link for messages, a scheduled send, reordering the chapters, timed
 * captions, and edits after purchase (final once created, like every other
 * product). The branding line is always shown, as on every other live page.
 */
export const graduationKeepsakeModule: ProductModuleConfig<GraduationValues> = {
  formSchema: graduationSchema,
  themes: graduationThemes,
  renderer: { kind: "live" },
  pricing: graduationPricing,
  delivery: { mode: "hosted", hosted: { description: "delivery.hosted" } },
  messages: graduationMessages,
  createInitialState,
  createInitialThemeSelections,
  validate: validateGraduation,
  livePreview: { component: GraduationLivePreview },
};
