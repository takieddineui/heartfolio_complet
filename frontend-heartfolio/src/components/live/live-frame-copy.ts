/**
 * The words of the frame around every live page (owner, 27 Oct 2026): the
 * shared Heartfolio intro and the closing line, in the ORDER's language like
 * the rest of the page. English and French approved by the owner; Arabic
 * translated, not native-reviewed. The name and the address are never
 * translated.
 */
export interface LiveFrameCopy {
  /** Under the mark in the intro. */
  introLine: string;
  /** The intro's skip button. */
  skip: string;
  /** Before " · theheartfolio.com" at the end of every live page. */
  madeWith: string;
}

export const LIVE_FRAME_COPY: Record<"en" | "fr" | "ar", LiveFrameCopy> = {
  en: { introLine: "A gift for you", skip: "Skip", madeWith: "Made with Heartfolio" },
  fr: { introLine: "Un cadeau pour toi", skip: "Passer", madeWith: "Créé avec Heartfolio" },
  ar: { introLine: "هديّة لك", skip: "تخطٍّ", madeWith: "صُنع باستخدام Heartfolio" },
};

export function liveFrameCopy(locale: string | undefined): LiveFrameCopy {
  return LIVE_FRAME_COPY[locale === "fr" || locale === "ar" ? locale : "en"];
}
