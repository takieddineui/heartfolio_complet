import type { Lang } from "../../model";

/**
 * Next Chapter Airways - this journey's own wording, in the keepsake's
 * language. Chapter titles and labels come from here, not from the creator
 * (the spec's "chapter titles and labels come from the chosen journey").
 */
export interface AirlineWords {
  start: string;
  welcome: string;
  path: string;
  then: string;
  now: string;
  next: string;
  ach: string;
  achHint: string;
  achCount: string;
  msg: string;
  msgHint: string;
  goals: string;
  goalTag: string;
  letter: string;
  finale: string;
  /** Boarding-pass defaults, used only where the creator left a field empty. */
  defaultAirline: string;
  defaultFromPlace: string;
  defaultToPlace: string;
  defaultCabin: string;
  defaultSeat: string;
  /** Hero caption: `{seat} · {cabin}`. */
  seatLine: string;
  /** Letter chapter label for the sender block. */
  stampAria: string;
  /** `{n}`: an unstamped passport page, for assistive tech. */
  pageAria: string;
  /** `{n}`: the number of a postcard, for assistive tech. */
  postcardAria: string;
  postcardFlip: string;
}

export const AIRLINE_WORDS: Record<Lang, AirlineWords> = {
  en: {
    start: "Tear to board",
    welcome: "Welcome aboard, {name}",
    path: "Your flight path",
    then: "Departure",
    now: "Now boarding",
    next: "Destination",
    ach: "Your passport",
    achHint: "Tap each page to stamp it",
    achCount: "{n} of {t} stamped",
    msg: "Postcards for the journey",
    msgHint: "Tap a postcard to turn it over",
    goals: "Your itinerary",
    goalTag: "Planned",
    letter: "A note from your crew",
    finale: "Ready for take-off",
    defaultAirline: "Next Chapter Airways",
    defaultFromPlace: "Childhood",
    defaultToPlace: "What's next",
    defaultCabin: "First Class Honours",
    defaultSeat: "1A",
    seatLine: "{seat} · {cabin}",
    stampAria: "Stamp: {title}",
    pageAria: "Passport page {n}",
    postcardAria: "Postcard from {name}",
    postcardFlip: "Turn the postcard",
  },
  fr: {
    start: "Déchirez pour embarquer",
    welcome: "Bienvenue à bord, {name}",
    path: "Votre plan de vol",
    then: "Départ",
    now: "Embarquement immédiat",
    next: "Destination",
    ach: "Votre passeport",
    achHint: "Touchez chaque page pour la tamponner",
    achCount: "{n} sur {t} tamponnées",
    msg: "Cartes postales du voyage",
    msgHint: "Touchez une carte postale pour la retourner",
    goals: "Votre itinéraire",
    goalTag: "Prévu",
    letter: "Un mot de votre équipage",
    finale: "Prêt au décollage",
    defaultAirline: "Next Chapter Airways",
    defaultFromPlace: "Enfance",
    defaultToPlace: "Et après",
    defaultCabin: "Première classe, avec les honneurs",
    defaultSeat: "1A",
    seatLine: "{seat} · {cabin}",
    stampAria: "Tampon : {title}",
    pageAria: "Page {n} du passeport",
    postcardAria: "Carte postale de {name}",
    postcardFlip: "Retourner la carte postale",
  },
  ar: {
    start: "مزّق للصعود",
    welcome: "أهلًا على متن الرحلة، {name}",
    path: "مسار رحلتك",
    then: "الإقلاع",
    now: "الصعود الآن",
    next: "الوجهة",
    ach: "جواز سفرك",
    achHint: "المس كل صفحة لتختمها",
    achCount: "تم ختم {n} من {t}",
    msg: "بطاقات بريدية للرحلة",
    msgHint: "المس بطاقة لتقلبها",
    goals: "خط سيرك",
    goalTag: "مخطط",
    letter: "كلمة من طاقمك",
    finale: "جاهز للإقلاع",
    defaultAirline: "Next Chapter Airways",
    defaultFromPlace: "الطفولة",
    defaultToPlace: "ما التالي",
    defaultCabin: "الدرجة الأولى مع مرتبة الشرف",
    defaultSeat: "1A",
    seatLine: "{seat} · {cabin}",
    stampAria: "ختم: {title}",
    pageAria: "صفحة جواز السفر {n}",
    postcardAria: "بطاقة بريدية من {name}",
    postcardFlip: "اقلب البطاقة البريدية",
  },
};
