import type { ThemeEngineConfig } from "@/types/studio";
import { DEFAULT_JOURNEY, JOURNEYS } from "./journeys";

/**
 * One axis: the JOURNEY. Structural (`kind: "select"`, no `tokens`), read
 * directly from `themeSelections.journey` by the live page, the same
 * category as Love Story Timeline's `layout` and Song Poster's `theme`.
 *
 * Options are generated from the journey registry, never hand-listed, so the
 * picker can only ever offer a journey whose page exists.
 *
 * There is no palette or typography axis on purpose: each journey is a
 * complete designed world (its own colours, fonts and sounds), not a skin
 * over a shared one.
 */
export const graduationThemes: ThemeEngineConfig = {
  axes: [
    {
      id: "journey",
      label: "themes.journey.label",
      kind: "select",
      defaultOptionId: DEFAULT_JOURNEY,
      options: JOURNEYS.map((journey) => ({
        id: journey.id,
        label: `themes.journey.options.${journey.id}`,
        swatch: journey.swatch,
      })),
    },
  ],
};
