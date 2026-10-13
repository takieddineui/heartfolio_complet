import type { Lang } from "./model";

/**
 * Wording shared by every journey, in the KEEPSAKE's language (the creator's
 * choice, `values.language`), not the site's. Each journey adds its own words
 * (`journeys/<id>/words.ts`).
 *
 * Everything the prototype hardcoded in English lives here or there. Nothing
 * on the page may claim a feature that does not exist: there is no "everyone
 * who wrote will see your reply" because there is nothing that sends one yet.
 */
export interface SharedCopy {
  soundOn: string;
  soundOff: string;
  share: string;
  copied: string;
  copyFailed: string;
  again: string;
  close: string;
  voicePlay: string;
  voicePause: string;
  prevPhoto: string;
  nextPhoto: string;
  greetingsFrom: string;
  passenger: string;
  flight: string;
  gate: string;
  seat: string;
  boarding: string;
  cabin: string;
  openPhoto: string;
  drawingBy: string;
  signedBy: string;
  startHint: string;
  /** Page title for assistive tech, `{name}` / `{year}`. */
  pageLabel: string;
}

export const SHARED_COPY: Record<Lang, SharedCopy> = {
  en: {
    soundOn: "Sound on",
    soundOff: "Sound off",
    share: "Share",
    copied: "Link copied",
    copyFailed: "Could not copy the link",
    again: "Start again",
    close: "Close",
    voicePlay: "Play voice message",
    voicePause: "Pause voice message",
    prevPhoto: "Previous photo",
    nextPhoto: "Next photo",
    greetingsFrom: "Greetings from",
    passenger: "Passenger",
    flight: "Flight",
    gate: "Gate",
    seat: "Seat",
    boarding: "Boarding",
    cabin: "Class",
    openPhoto: "Open photo: {caption}",
    drawingBy: "Drawing by {name}",
    signedBy: "Signed by",
    startHint: "Tap to begin",
    pageLabel: "{name}, class of {year}",
  },
  fr: {
    soundOn: "Son activé",
    soundOff: "Son coupé",
    share: "Partager",
    copied: "Lien copié",
    copyFailed: "Impossible de copier le lien",
    again: "Recommencer",
    close: "Fermer",
    voicePlay: "Écouter le message vocal",
    voicePause: "Mettre en pause le message vocal",
    prevPhoto: "Photo précédente",
    nextPhoto: "Photo suivante",
    greetingsFrom: "Salutations de",
    passenger: "Passager",
    flight: "Vol",
    gate: "Porte",
    seat: "Siège",
    boarding: "Embarquement",
    cabin: "Classe",
    openPhoto: "Ouvrir la photo : {caption}",
    drawingBy: "Dessin de {name}",
    signedBy: "Signé par",
    startHint: "Touchez pour commencer",
    pageLabel: "{name}, promotion {year}",
  },
  ar: {
    soundOn: "الصوت مفعّل",
    soundOff: "الصوت متوقف",
    share: "مشاركة",
    copied: "تم نسخ الرابط",
    copyFailed: "تعذّر نسخ الرابط",
    again: "ابدأ من جديد",
    close: "إغلاق",
    voicePlay: "تشغيل الرسالة الصوتية",
    voicePause: "إيقاف الرسالة الصوتية مؤقتًا",
    prevPhoto: "الصورة السابقة",
    nextPhoto: "الصورة التالية",
    greetingsFrom: "تحيات من",
    passenger: "المسافر",
    flight: "الرحلة",
    gate: "البوابة",
    seat: "المقعد",
    boarding: "الصعود",
    cabin: "الدرجة",
    openPhoto: "افتح الصورة: {caption}",
    drawingBy: "رسمة من {name}",
    signedBy: "وقّع عليها",
    startHint: "المس للبدء",
    pageLabel: "{name}، دفعة {year}",
  },
};
