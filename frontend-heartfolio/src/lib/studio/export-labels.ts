import type { LocaleCode } from "@/types/studio";

/**
 * The labels of the shared print and wallpaper targets, one copy for every
 * product that sells them (`allPrintTargets()` and `allWallpaperTargets()`
 * build the keys: `exports.print.<size>.<mounting>` and
 * `exports.<device.labelKey>`). Love Story Timeline's own wording, moved here
 * unchanged on 19 Oct 2026 so Song Poster, which uses the same targets and
 * showed the raw keys, cannot drift from it. A module spreads its locale's
 * entry into its own dictionary. `export-labels.test.ts` fails if a target
 * has no label in any locale.
 */
export const SHARED_EXPORT_LABELS: Record<LocaleCode, Record<string, string>> = {
  en: {
    "exports.print.a4.frameless": "A4 / A3 — frameless, for glass mounting",
    "exports.print.a4.edged": "A4 / A3 — with edges, for a frame",
    "exports.print.classic.frameless": "Classic 8×10 — frameless, for glass mounting",
    "exports.print.classic.edged": "Classic 8×10 — with edges, for a frame",
    "exports.print.poster.frameless": "Poster 12×18 — frameless, for glass mounting",
    "exports.print.poster.edged": "Poster 12×18 — with edges, for a frame",
    "exports.wallpaper.phone": "Phone wallpaper — 1290 × 2796",
    "exports.wallpaper.tablet": "Tablet wallpaper — 2048 × 2732",
    "exports.wallpaper.desktop": "Desktop wallpaper — 3840 × 2160",
  },
  fr: {
    "exports.print.a4.frameless": "A4 / A3 — sans bordure, pour montage sur verre",
    "exports.print.a4.edged": "A4 / A3 — avec marges, pour un cadre",
    "exports.print.classic.frameless": "Classique 8×10 — sans bordure, pour montage sur verre",
    "exports.print.classic.edged": "Classique 8×10 — avec marges, pour un cadre",
    "exports.print.poster.frameless": "Affiche 12×18 — sans bordure, pour montage sur verre",
    "exports.print.poster.edged": "Affiche 12×18 — avec marges, pour un cadre",
    "exports.wallpaper.phone": "Fond d'écran téléphone — 1290 × 2796",
    "exports.wallpaper.tablet": "Fond d'écran tablette — 2048 × 2732",
    "exports.wallpaper.desktop": "Fond d'écran ordinateur — 3840 × 2160",
  },
  ar: {
    "exports.print.a4.frameless": "A4 / A3 — بلا حواف، للتثبيت على الزجاج",
    "exports.print.a4.edged": "A4 / A3 — بحواف، للإطار التقليدي",
    "exports.print.classic.frameless": "كلاسيكي ٨×١٠ — بلا حواف، للتثبيت على الزجاج",
    "exports.print.classic.edged": "كلاسيكي ٨×١٠ — بحواف، للإطار التقليدي",
    "exports.print.poster.frameless": "ملصق ١٢×١٨ — بلا حواف، للتثبيت على الزجاج",
    "exports.print.poster.edged": "ملصق ١٢×١٨ — بحواف، للإطار التقليدي",
    "exports.wallpaper.phone": "خلفية للهاتف — ١٢٩٠ × ٢٧٩٦",
    "exports.wallpaper.tablet": "خلفية للوحي — ٢٠٤٨ × ٢٧٣٢",
    "exports.wallpaper.desktop": "خلفية للحاسوب — ٣٨٤٠ × ٢١٦٠",
  },
};
