import type { ThemeEngineConfig } from "@/types/studio";
import { FORMAT_PRESETS } from "@/lib/studio/format-presets";

export const mapThemes: ThemeEngineConfig = {
  axes: [
    {
      id: "palette",
      label: "themes.palette.label",
      kind: "swatch",
      defaultOptionId: "classic",
      options: [
        { id: "classic", label: "themes.palette.options.classic", swatch: "#f7f1e6", tokens: { "--p-bg": "#f7f1e6", "--p-text": "#3a3a38", "--p-muted": "#8a8578", "--p-accent": "#c9a24b", "--p-line": "#c9beac" } },
        { id: "midnight", label: "themes.palette.options.midnight", swatch: "#141b2e", tokens: { "--p-bg": "#141b2e", "--p-text": "#f7f1e6", "--p-muted": "#8a91a8", "--p-accent": "#c9a24b", "--p-line": "#3a4462" } },
        { id: "sage", label: "themes.palette.options.sage", swatch: "#e8ede2", tokens: { "--p-bg": "#e8ede2", "--p-text": "#3a4536", "--p-muted": "#7f8f74", "--p-accent": "#6b7a5e", "--p-line": "#b7c7ab" } },
        { id: "terracotta", label: "themes.palette.options.terracotta", swatch: "#e7cba0", tokens: { "--p-bg": "#e7cba0", "--p-text": "#3a2a22", "--p-muted": "#8f6f52", "--p-accent": "#b5654b", "--p-line": "#c9a877" } },
      ],
    },
    {
      id: "typography",
      label: "themes.typography.label",
      kind: "select",
      defaultOptionId: "serif-classic",
      options: [
        { id: "serif-classic", label: "themes.typography.options.serifClassic", tokens: { "--map-heading-font": "'Fraunces', Georgia, serif", "--map-body-font": "'Inter', sans-serif" } },
        { id: "modern", label: "themes.typography.options.modern", tokens: { "--map-heading-font": "'Inter', sans-serif", "--map-body-font": "'Inter', sans-serif" } },
      ],
    },
    {
      id: "mapStyle",
      label: "themes.mapStyle.label",
      kind: "select",
      defaultOptionId: "line",
      // Structural — the renderer draws a different decorative SVG map
      // background per option. Not expressible as CSS-variable tokens,
      // same as Timeline's "layout" axis.
      options: [
        { id: "line", label: "themes.mapStyle.options.line" },
        { id: "vintage", label: "themes.mapStyle.options.vintage" },
        { id: "night", label: "themes.mapStyle.options.night" },
        { id: "topographic", label: "themes.mapStyle.options.topographic" },
      ],
    },
    {
      id: "markerStyle",
      label: "themes.markerStyle.label",
      kind: "select",
      defaultOptionId: "heart",
      options: [
        { id: "pin", label: "themes.markerStyle.options.pin" },
        { id: "heart", label: "themes.markerStyle.options.heart" },
        { id: "star", label: "themes.markerStyle.options.star" },
        { id: "dot", label: "themes.markerStyle.options.dot" },
      ],
    },
    {
      id: "frame",
      label: "themes.frame.label",
      kind: "select",
      defaultOptionId: "thin-black",
      options: [
        { id: "none", label: "themes.frame.options.none" },
        { id: "thin-black", label: "themes.frame.options.thinBlack" },
        { id: "vintage", label: "themes.frame.options.vintage" },
      ],
    },
    {
      id: "format",
      label: "themes.format.label",
      kind: "select",
      defaultOptionId: "print",
      options: FORMAT_PRESETS.map((f) => ({ id: f.id, label: `themes.format.options.${f.id}` })),
    },
    {
      id: "scale",
      label: "themes.scale.label",
      kind: "range",
      min: 80,
      max: 120,
      step: 5,
      defaultValue: 100,
      cssVar: "--text-scale",
      transform: (v) => String(v / 100),
    },
  ],
};

// Smart default: the "night" map style suggests the "midnight" palette,
// since a light palette on a night-sky map style reads as a mismatch.
// A different axis pairing than Timeline's (palette->frame), showing
// `defaultFor` isn't a Timeline-specific pattern.
for (const axis of mapThemes.axes) {
  if (axis.id === "palette") {
    axis.defaultFor = { "mapStyle:night": "midnight" };
  }
}
