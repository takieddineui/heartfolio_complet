import type { ThemeEngineConfig } from "@/types/studio";
import { TIMELINE_LAYOUTS } from "./layouts";

export const timelineThemes: ThemeEngineConfig = {
  axes: [
    {
      id: "palette",
      label: "themes.palette.label",
      kind: "swatch",
      defaultOptionId: "classic",
      options: [
        { id: "classic", label: "themes.palette.options.classic", swatch: "#f7f1e6", tokens: { "--p-bg": "#f7f1e6", "--p-text": "#3a3a38", "--p-muted": "#8a8578", "--p-accent": "#c9a24b", "--p-line": "#dcd4c4" } },
        { id: "blush", label: "themes.palette.options.blush", swatch: "#f3e3e0", tokens: { "--p-bg": "#f3e3e0", "--p-text": "#4a2f2b", "--p-muted": "#a67f78", "--p-accent": "#b5654b", "--p-line": "#e3c9c3" } },
        { id: "midnight", label: "themes.palette.options.midnight", swatch: "#141b2e", tokens: { "--p-bg": "#141b2e", "--p-text": "#f7f1e6", "--p-muted": "#8a91a8", "--p-accent": "#c9a24b", "--p-line": "#2c3248" } },
        { id: "sage", label: "themes.palette.options.sage", swatch: "#e8ede2", tokens: { "--p-bg": "#e8ede2", "--p-text": "#3a4536", "--p-muted": "#7f8f74", "--p-accent": "#6b7a5e", "--p-line": "#cdd8c3" } },
        { id: "terracotta", label: "themes.palette.options.terracotta", swatch: "#e7cba0", tokens: { "--p-bg": "#e7cba0", "--p-text": "#3a2a22", "--p-muted": "#8f6f52", "--p-accent": "#b5654b", "--p-line": "#d8b98a" } },
        { id: "monochrome", label: "themes.palette.options.monochrome", swatch: "#ffffff", tokens: { "--p-bg": "#ffffff", "--p-text": "#141414", "--p-muted": "#8a8a8a", "--p-accent": "#141414", "--p-line": "#d9d9d9" } },
        { id: "gold", label: "themes.palette.options.gold", swatch: "#fdf6e3", tokens: { "--p-bg": "#fdf6e3", "--p-text": "#332b12", "--p-muted": "#9c8a52", "--p-accent": "#c9a24b", "--p-line": "#e8dcb0" } },
        { id: "forest", label: "themes.palette.options.forest", swatch: "#1d2b22", tokens: { "--p-bg": "#1d2b22", "--p-text": "#e8f0e6", "--p-muted": "#87a08f", "--p-accent": "#c9a24b", "--p-line": "#2f4236" } },
      ],
    },
    {
      id: "typography",
      label: "themes.typography.label",
      kind: "select",
      defaultOptionId: "serif-classic",
      options: [
        { id: "serif-classic", label: "themes.typography.options.serifClassic", tokens: { "--poster-heading-font": "'Fraunces', Georgia, serif", "--poster-body-font": "'Inter', sans-serif" } },
        { id: "modern", label: "themes.typography.options.modern", tokens: { "--poster-heading-font": "'Inter', sans-serif", "--poster-body-font": "'Inter', sans-serif" } },
        { id: "script", label: "themes.typography.options.script", tokens: { "--poster-heading-font": "'Fraunces', cursive", "--poster-body-font": "'Inter', sans-serif" } },
        { id: "typewriter", label: "themes.typography.options.typewriter", tokens: { "--poster-heading-font": "'JetBrains Mono', monospace", "--poster-body-font": "'JetBrains Mono', monospace" } },
      ],
    },
    {
      id: "layout",
      label: "themes.layout.label",
      kind: "select",
      // §11 — the label reads as "Story Style" to the customer even though
      // the internal axis id stays "layout". Renaming the id would touch
      // the renderer, the Python compositions module, the orientation
      // lookup and every parity test that keys off `themeSelections.layout`
      // / `timeline.layout` — real risk for zero functional gain, the same
      // reasoning that kept the "live" pack's DB slug unchanged when its
      // display label became "Digital".
      defaultOptionId: "neat-stack",
      // §11/§12 — this used to list five ids (standard/alternating/
      // centered/journal/cards) that predate the six-composition rework.
      // None of those ids exist in `layouts.ts` or `compositions.py`
      // anymore, so three of the five choices silently rendered the exact
      // same fallback composition and the two landscape compositions were
      // not selectable in the Studio AT ALL — this is almost certainly the
      // concrete cause of "layouts are broken and can ruin the poster
      // composition." The fix is reading from the real registry rather
      // than hand-maintaining a second, driftable list.
      options: TIMELINE_LAYOUTS.map((layout) => ({
        id: layout.id,
        label: `layouts.${layout.i18nKey}.name`,
      })),
    },
    {
      id: "scale",
      label: "themes.scale.label",
      kind: "range",
      min: 70,
      max: 130,
      step: 5,
      defaultValue: 100,
      cssVar: "--text-scale",
      transform: (v) => String(v / 100),
    },
  ],
};

/**
 * §10 — palette no longer suggests ANYTHING on another axis.
 *
 * This used to also carry a `paletteToTypography` map, on the reasoning
 * that `ThemePicker`'s `touchedRef` guard makes a smart default genuinely
 * safe — it only ever fills an axis the customer has never explicitly
 * touched, and permanently stops once they do (see theme-picker.tsx).
 * That guard is real and well-built, but §10's own list is explicit and
 * exhaustive: "[palette] must not modify: frame, composition, layout,
 * typography, unrelated Studio UI, structural properties." Typography is
 * named directly, not left to infer — a customer who picks "Midnight" and
 * watches their typography visibly change to "Modern" experiences that as
 * palette changing typography, whether or not the code beneath it is
 * happy to be reversed. Removed for the same reason `paletteToFrame` was
 * removed alongside the frame axis itself.
 *
 * No axis in this module sets `defaultFor` anymore, so there is nothing
 * left to wire up here — the loop that used to do it is gone with it.
 */
