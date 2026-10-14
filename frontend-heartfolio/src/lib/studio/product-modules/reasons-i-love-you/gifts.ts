/**
 * THE FOUR GIFTS: how the reasons are given.
 *
 * Each is its own experience (material, interaction, fonts and instrument),
 * not a theme of one template. The values are the prototype's
 * (`reasons-i-love-you.html`, `GIFTS`), kept exactly: the instruments, tempos,
 * scales and chords are what the procedural music plays, and nothing here is
 * an audio file.
 *
 * The backend keeps the same four ids (`GIFTS` in `data.py`); a test pins them.
 */
export const GIFT_IDS = ["jar", "daisy", "deck", "cookies"] as const;
export type GiftId = (typeof GIFT_IDS)[number];
export const DEFAULT_GIFT: GiftId = "jar";

export type Instrument = "kalimba" | "ukulele" | "vibraphone" | "chimes";

export interface GiftDefinition {
  id: GiftId;
  icon: string;
  /** The browser's theme colour while this gift is open. */
  theme: string;
  instrument: Instrument;
  bpm: number;
  /** MIDI note numbers. Kalimba and chimes play from a scale. */
  scale?: readonly number[];
  /** MIDI note numbers. Ukulele and vibraphone play chords. */
  chords?: readonly (readonly number[])[];
}

export const GIFTS: Record<GiftId, GiftDefinition> = {
  jar: { id: "jar", icon: "🫙", theme: "#f6e7d3", instrument: "kalimba", bpm: 84, scale: [62, 64, 66, 69, 71, 74, 76, 78] },
  daisy: {
    id: "daisy",
    icon: "🌼",
    theme: "#cfe8d5",
    instrument: "ukulele",
    bpm: 100,
    chords: [
      [60, 64, 67, 72],
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [55, 59, 62, 67],
    ],
  },
  deck: {
    id: "deck",
    icon: "🃏",
    theme: "#163d2c",
    instrument: "vibraphone",
    bpm: 66,
    chords: [
      [62, 65, 69, 72],
      [55, 59, 62, 65],
      [60, 64, 67, 71],
      [57, 60, 64, 67],
    ],
  },
  cookies: { id: "cookies", icon: "🥠", theme: "#f3dcc0", instrument: "chimes", bpm: 56, scale: [74, 76, 79, 81, 83, 86, 88, 91] },
};

export function giftOrDefault(id: unknown): GiftId {
  return (GIFT_IDS as readonly unknown[]).includes(id) ? (id as GiftId) : DEFAULT_GIFT;
}
