import type { ProductModuleConfig } from "@/types/studio";
import { createInitialState, createInitialThemeSelections, type ReasonsValues } from "./initial-state";
import { ReasonsLivePreview } from "./live-preview";
import { reasonsMessages } from "./messages";
import { reasonsPricing } from "./pricing";
import { reasonsSchema } from "./schema";
import { reasonsThemes } from "./themes";
import { validateReasons } from "./validation";

/**
 * REASONS I LOVE YOU: the first live-only product. There is no print, no
 * renderer, no wallpaper and no file: the customer buys the hosted page.
 *
 * So the preview is `kind: "live"` (the Studio mounts `livePreview` full-pane,
 * with no Artwork/Framed tabs, which would have nothing to show), and delivery
 * is `"hosted"` (the sidebar says it is a link, not a download).
 *
 * OUT OF v1, DELIBERATELY, and not stubbed: the recipient's reply, any
 * tracking of whether it was opened, the own-song upload, a scheduled send,
 * drag-to-reorder, and edits after purchase (final once created, like every
 * other product). The branding line is always shown, as on every other live
 * page.
 */
export const reasonsILoveYouModule: ProductModuleConfig<ReasonsValues> = {
  formSchema: reasonsSchema,
  themes: reasonsThemes,
  renderer: { kind: "live" },
  pricing: reasonsPricing,
  delivery: { mode: "hosted", hosted: { description: "delivery.hosted" } },
  messages: reasonsMessages,
  createInitialState,
  createInitialThemeSelections,
  validate: validateReasons,
  livePreview: { component: ReasonsLivePreview },
};
