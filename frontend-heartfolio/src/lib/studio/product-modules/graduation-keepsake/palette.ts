/**
 * The two CLOSED vocabularies a person in the Messages chapter is given: a
 * colour and an emoji.
 *
 * WHY IDS, NOT HEX CODES OR EMOJI. The Studio stores `"coral"` and
 * `"home"`, never `#ff6b4a` or an emoji character, because a person's colour
 * is written into a `style` attribute on the live page: a free-text colour
 * there is a CSS injection surface. The backend validates against the same
 * ids (`graduation_keepsake/data.py`: PERSON_COLORS, PERSON_EMOJIS) and a test
 * here (`palette.test.ts`) reads that file, so the two lists cannot drift.
 *
 * The prototype's `color` and `emoji` were free text. That was fine for a
 * demo and is not for a page that renders other people's strings.
 */

export interface PersonColor {
  id: string;
  hex: string;
  names: { en: string; fr: string; ar: string };
}

export interface PersonEmoji {
  id: string;
  glyph: string;
  names: { en: string; fr: string; ar: string };
}

export const PERSON_COLORS: readonly PersonColor[] = [
  { id: "coral", hex: "#ff6b4a", names: { en: "Coral", fr: "Corail", ar: "مرجاني" } },
  { id: "blue", hex: "#2f7fd8", names: { en: "Blue", fr: "Bleu", ar: "أزرق" } },
  { id: "amber", hex: "#ffb547", names: { en: "Amber", fr: "Ambre", ar: "كهرماني" } },
  { id: "green", hex: "#2fae86", names: { en: "Green", fr: "Vert", ar: "أخضر" } },
  { id: "pink", hex: "#c95ab0", names: { en: "Pink", fr: "Rose", ar: "وردي" } },
  { id: "violet", hex: "#7a5cd6", names: { en: "Violet", fr: "Violet", ar: "بنفسجي" } },
  { id: "navy", hex: "#0f2742", names: { en: "Navy", fr: "Bleu marine", ar: "كحلي" } },
  { id: "red", hex: "#d64545", names: { en: "Red", fr: "Rouge", ar: "أحمر" } },
];

export const PERSON_EMOJIS: readonly PersonEmoji[] = [
  { id: "home", glyph: "🏡", names: { en: "Home", fr: "Maison", ar: "المنزل" } },
  { id: "coffee", glyph: "☕", names: { en: "Coffee", fr: "Café", ar: "قهوة" } },
  { id: "tree", glyph: "🌳", names: { en: "Tree", fr: "Arbre", ar: "شجرة" } },
  { id: "pencil", glyph: "✏️", names: { en: "Pencil", fr: "Crayon", ar: "قلم" } },
  { id: "party", glyph: "🎉", names: { en: "Party", fr: "Fête", ar: "حفلة" } },
  { id: "school", glyph: "🏫", names: { en: "School", fr: "École", ar: "مدرسة" } },
  { id: "heart", glyph: "❤️", names: { en: "Heart", fr: "Cœur", ar: "قلب" } },
  { id: "star", glyph: "⭐", names: { en: "Star", fr: "Étoile", ar: "نجمة" } },
  { id: "book", glyph: "📚", names: { en: "Books", fr: "Livres", ar: "كتب" } },
  { id: "music", glyph: "🎵", names: { en: "Music", fr: "Musique", ar: "موسيقى" } },
  { id: "camera", glyph: "📷", names: { en: "Camera", fr: "Appareil photo", ar: "كاميرا" } },
  { id: "cake", glyph: "🎂", names: { en: "Cake", fr: "Gâteau", ar: "كعكة" } },
  { id: "dog", glyph: "🐶", names: { en: "Dog", fr: "Chien", ar: "كلب" } },
  { id: "cat", glyph: "🐱", names: { en: "Cat", fr: "Chat", ar: "قطة" } },
  { id: "sun", glyph: "☀️", names: { en: "Sun", fr: "Soleil", ar: "شمس" } },
  { id: "rocket", glyph: "🚀", names: { en: "Rocket", fr: "Fusée", ar: "صاروخ" } },
  { id: "palette", glyph: "🎨", names: { en: "Art", fr: "Art", ar: "فن" } },
  { id: "plane", glyph: "✈️", names: { en: "Plane", fr: "Avion", ar: "طائرة" } },
  { id: "cap", glyph: "🎓", names: { en: "Graduation cap", fr: "Toque", ar: "قبعة التخرج" } },
  { id: "hug", glyph: "🤗", names: { en: "Hug", fr: "Câlin", ar: "عناق" } },
];

export const DEFAULT_PERSON_COLOR = "coral";
export const DEFAULT_PERSON_EMOJI = "heart";

/** A colour id -> hex. An unknown id (a project saved by a newer palette)
 * falls back to the default rather than producing an invalid CSS value. */
export function personColorHex(id: string | undefined): string {
  return (PERSON_COLORS.find((c) => c.id === id) ?? PERSON_COLORS[0]!).hex;
}

/** An emoji id -> the glyph to draw; unknown ids fall back to the default. */
export function personEmojiGlyph(id: string | undefined): string {
  return (PERSON_EMOJIS.find((e) => e.id === id) ?? PERSON_EMOJIS.find((e) => e.id === DEFAULT_PERSON_EMOJI)!).glyph;
}
