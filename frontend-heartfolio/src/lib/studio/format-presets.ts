/** Shared design-canvas aspect ratios for any poster-shaped Product
 * Module's "format" theme axis. Originally lived inside the Love Story
 * Timeline module; promoted here once Where We Met Map needed the exact
 * same vocabulary — a second consumer is what proved this was shared
 * data, not Timeline-specific data that happened to be reused.
 *
 * Deliberately has no `label` field: display text is always a
 * translation key resolved against a *module's* own `messages`
 * dictionary (see `lib/studio/i18n.ts`), and a module's own
 * `themes.ts` is expected to map these ids to its own keys, e.g.
 * `FORMAT_PRESETS.map(f => ({ id: f.id, label: \`themes.format.options.${f.id}\` }))`.
 * A shared "label" string here would either go unused (as it did in
 * Timeline's original copy) or tempt a module into skipping
 * localization entirely — omitting it removes that trap. */
export interface FormatPreset {
  id: string;
  width: number;
  height: number;
}

/** On-screen design sizes. Export sizes are deliberately separate (see
 * each module's `exports.ts`) — a person designs at these proportions,
 * then exports at whatever resolution the deliverable needs, which may
 * not be a 1:1 pixel match of the design canvas. */
const STORY_PRESET: FormatPreset = { id: "story", width: 450, height: 800 };

export const FORMAT_PRESETS: FormatPreset[] = [
  STORY_PRESET,
  { id: "square", width: 600, height: 600 },
  { id: "landscape", width: 800, height: 450 },
  { id: "portrait", width: 540, height: 675 },
  { id: "print", width: 595, height: 842 },
];

/** The preset used when no format is selected yet, or when a stored
 * selection no longer matches a known preset. Declared as its own named
 * constant rather than read back out of the array as `FORMAT_PRESETS[0]`,
 * so the "there is always a fallback" guarantee is expressed in the type
 * system instead of relying on the array being non-empty. Same value,
 * same runtime behaviour. */
const DEFAULT_FORMAT_PRESET: FormatPreset = STORY_PRESET;

export function getFormatPreset(id: string | undefined): FormatPreset {
  return FORMAT_PRESETS.find((f) => f.id === id) ?? DEFAULT_FORMAT_PRESET;
}
