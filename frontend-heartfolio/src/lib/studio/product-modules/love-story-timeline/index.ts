import type { ProductModuleConfig } from "@/types/studio";
import { timelineSchema } from "./schema";
import { timelineThemes } from "./themes";
import { LoveStoryTimelineRenderer } from "./renderer";
import { timelinePricing } from "./pricing";
import { timelineExports } from "./exports";
import { validateTimeline } from "./validation";
import { timelineMessages } from "./messages";
import { createInitialState, createInitialThemeSelections, type TimelineValues } from "./initial-state";
import { getLayout } from "./layouts";
import { TimelineLivePreview } from "./live-preview";

/**
 * §12/§14 — canvas size follows the selected COMPOSITION, not a separate
 * customer-facing "format" choice.
 *
 * This used to read a `format` theme axis (Story 9:16 / Square / Landscape
 * / Portrait / Print) that had nothing to do with which of the six
 * compositions was actually selected — a customer could pick "Landscape"
 * while their poster was a portrait layout, and the preview canvas would
 * disagree with the poster it was framing. §7's layout registry already
 * carries the one orientation fact that actually matters
 * (`orientation: "portrait" | "landscape"`), so the canvas now reads from
 * there directly. Fixed dimensions per orientation rather than reusing the
 * old format-preset sizes verbatim, since those were named for formats
 * ("Story", "Square") that no longer exist as a concept here.
 */
const PORTRAIT_CANVAS = { width: 540, height: 810 };
const LANDSCAPE_CANVAS = { width: 810, height: 540 };

export const loveStoryTimelineModule: ProductModuleConfig<TimelineValues> = {
  formSchema: timelineSchema,
  themes: timelineThemes,
  renderer: {
    kind: "component",
    component: LoveStoryTimelineRenderer,
    intrinsicSize: (_values, themeSelections) => {
      const layout = getLayout(themeSelections.layout as string | undefined);
      return layout.orientation === "landscape" ? LANDSCAPE_CANVAS : PORTRAIT_CANVAS;
    },
  },
  pricing: timelinePricing,
  delivery: {
    mode: "export",
    // §15 — the raw export-dimension list ("A4 frameless, 2480×3508" etc.)
    // is implementation detail, not a customer decision. `targets` itself
    // stays populated: the delivery pipeline and admin tooling still read
    // it, only the sidebar panel is opted out.
    export: { ...timelineExports, hideCustomerFacingList: true },
  },
  messages: timelineMessages,
  createInitialState,
  createInitialThemeSelections,
  validate: validateTimeline,
  // §16 — the real interactive Digital preview, not a static mockup. See
  // `live-preview.tsx` for why this needs no server round-trip at all.
  livePreview: { component: TimelineLivePreview },
};
