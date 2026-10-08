/**
 * §4 — background music, as a preset selection rather than a free upload.
 *
 * NO AUDIO FILES EXIST YET. Every id below resolves to
 * `/audio/presets/<id>.mp3`, which is not in the repository — by explicit
 * decision, rather than filled with a placeholder tone, since a fabricated
 * "romantic instrumental" would be worse than an honest gap. The Studio's
 * preset player must degrade quietly (no crash, no broken-audio error) for
 * a preset whose file does not exist yet.
 *
 * THE CONSTRAINT ON WHATEVER GETS ADDED HERE — instrumental, no vocals,
 * calm, suitable for a keepsake — is enforced by THIS FILE, not by taste at
 * upload time: whoever adds `tender-piano.mp3` reads this list and the
 * constraint it documents, rather than a separate spec living somewhere
 * else and drifting from what actually ships.
 *
 * "none" is not a special case handled elsewhere — it is a real, first
 * entry in this same list, so "does the customer see a way to choose no
 * music" and "is that choice a preset like any other" are the same
 * question with one answer.
 */

export interface MusicPreset {
  id: string;
  /** Resolved as `music.presets.<i18nKey>.name` in module messages. */
  i18nKey: string;
}

export const MUSIC_PRESETS: MusicPreset[] = [
  { id: "none", i18nKey: "none" },
  { id: "tender-piano", i18nKey: "tenderPiano" },
  { id: "quiet-strings", i18nKey: "quietStrings" },
  { id: "evening-glow", i18nKey: "eveningGlow" },
  { id: "still-waters", i18nKey: "stillWaters" },
];

export const DEFAULT_MUSIC_PRESET = "none";

export function isKnownMusicPreset(id: string | undefined | null): boolean {
  return MUSIC_PRESETS.some((preset) => preset.id === id);
}

/**
 * The playable URL for a preset, or `null` for "none" — matching the
 * `string | null` shape `LiveKeepsake`'s music toggle already expects, so
 * nothing downstream of this needed to change when music stopped being a
 * customer upload.
 *
 * MIRRORS `preset_music_url()` in the backend's `ar_support.py` exactly —
 * both compute `/audio/presets/<id>.mp3` from the same id, so the path
 * convention cannot drift between the two independent places that resolve
 * it (the Studio's in-editor Live preview, and the server-built AR/Live
 * payload).
 */
export function presetMusicUrl(presetId: string | undefined | null): string | null {
  if (!presetId || presetId === "none" || !isKnownMusicPreset(presetId)) return null;
  return `/audio/presets/${presetId}.mp3`;
}
