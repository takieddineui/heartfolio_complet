/**
 * The words around Song Poster's player, in the Studio's Player theme and on
 * the Digital page. They were English on /fr and /ar until 26 Oct 2026:
 * screen readers announced "Play", "Pause" and "Seek", and a broken video
 * said "This video stopped being playable." in every language.
 *
 * The player hook reports an error CODE (`YouTubePlayerError`); each screen
 * words it here, in its own language: the Studio's, or the order's on the
 * Digital page (as every live page does).
 */
import type { YouTubePlayerError } from "./use-youtube-player";

export interface PlayerCopy {
  play: string;
  pause: string;
  seek: string;
  errors: Record<YouTubePlayerError, string>;
}

export const PLAYER_COPY: Record<"en" | "fr" | "ar", PlayerCopy> = {
  en: {
    play: "Play",
    pause: "Pause",
    seek: "Seek",
    errors: {
      // The wording the English page has always shown.
      unplayable: "This video stopped being playable.",
      loadFailed: "Could not load the player.",
    },
  },
  fr: {
    play: "Lecture",
    pause: "Pause",
    seek: "Position dans la chanson",
    errors: {
      unplayable: "Cette vidéo ne peut plus être lue.",
      loadFailed: "Le lecteur n'a pas pu se charger.",
    },
  },
  ar: {
    play: "تشغيل",
    pause: "إيقاف مؤقت",
    seek: "موضع الأغنية",
    errors: {
      unplayable: "لم يعد بالإمكان تشغيل هذا الفيديو.",
      loadFailed: "تعذّر تحميل المشغّل.",
    },
  },
};

export function playerCopy(locale: string | undefined): PlayerCopy {
  return PLAYER_COPY[locale === "fr" || locale === "ar" ? locale : "en"];
}
