/**
 * The words around Love Story Timeline's live page, in the order's language.
 * They were English on /fr and /ar until 27 Oct 2026 (found in the storefront
 * captures): the opening's "Skip", the music toggle and the photo buttons.
 * The customer's own text is never translated; the branding line stays the
 * same on every live page, by decision.
 */
export interface LiveCopy {
  skip: string;
  /** The music toggle's name; its state is `aria-pressed`. */
  music: string;
  musicOn: string;
  musicOff: string;
  /** A milestone photo's button when the milestone has no title. */
  openPhoto: string;
  close: string;
}

export const LIVE_COPY: Record<"en" | "fr" | "ar", LiveCopy> = {
  en: { skip: "Skip", music: "Music", musicOn: "♪ on", musicOff: "♪ off", openPhoto: "Open photo", close: "Close" },
  fr: { skip: "Passer", music: "Musique", musicOn: "♪ activée", musicOff: "♪ coupée", openPhoto: "Ouvrir la photo", close: "Fermer" },
  ar: { skip: "تخطٍّ", music: "الموسيقى", musicOn: "♪ تعمل", musicOff: "♪ متوقفة", openPhoto: "فتح الصورة", close: "إغلاق" },
};

export function liveCopy(locale: string | undefined): LiveCopy {
  return LIVE_COPY[locale === "fr" || locale === "ar" ? locale : "en"];
}
