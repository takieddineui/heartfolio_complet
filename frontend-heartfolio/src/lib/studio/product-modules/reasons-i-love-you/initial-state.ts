import type { ThemeSelections } from "@/types/studio";
import { exampleLocale, type ExampleLocale } from "@/lib/studio/example-locale";
import { DEFAULT_GIFT } from "./gifts";

/** A photo as the Studio stores it: `assetId` once uploaded, `url` for the
 * preview. The backend trusts only `assetId` (see `data.py`). */
export interface ReasonPhoto {
  url: string;
  mimeType?: string;
  filename?: string;
  assetId?: string;
}

export interface Reason {
  text: string;
  photo?: ReasonPhoto;
  memory?: string;
}

export interface LetterParagraph {
  text: string;
}

/**
 * The customer's inputs, flat by field id (the Studio's form is keyed that
 * way). The prototype's nested `REASONS` object maps onto this; the reply,
 * the own-song upload, tracking, `meta.*` and the branding switch are
 * deliberately absent (v1 scope; see the module's `index.ts`).
 */
export interface ReasonsValues {
  toName: string;
  fromName: string;
  /** Empty means the localized default, "{count} reasons I love you". */
  title: string;
  reasons: Reason[];
  /** Empty means the localized default, "One more…". */
  finaleTeaser: string;
  finaleLine: string;
  /** Empty means the sender's name. */
  signature: string;
  letterEnabled: boolean;
  letterGreeting: string;
  letterParagraphs: LetterParagraph[];
  letterSignoff: string;
  music: boolean;
  showShare: boolean;
}

/** English example content, as every other product's Studio opens with (the
 * prototype's own "Theo & Hana"). */
/** The sample gift in each Studio language (25 Oct 2026: /fr and /ar opened
 *  with the English one). Same shape in every language; the Arabic sample
 *  uses Arabic names so its sentences read in one direction. */
const EXAMPLES: Record<ExampleLocale, Pick<ReasonsValues, "toName" | "fromName" | "reasons" | "finaleLine" | "letterGreeting" | "letterParagraphs" | "letterSignoff">> = {
  en: {
    toName: "Hana",
    fromName: "Theo",
    reasons: [
      { text: "The way you laugh at your own jokes, before you even reach the punchline." },
      { text: "How you make ordinary Tuesdays feel like something worth remembering.", memory: "Pancakes for dinner, March 2025." },
      { text: "You still say good morning like you mean it. Every single day." },
      { text: "The way you sing in the car, loudly and slightly wrong." },
      { text: "That you make me want to be kinder, calmer and braver, just by being you." },
    ],
    finaleLine: "And the reason above all: you are you. I choose you, every time.",
    letterGreeting: "Hana,",
    letterParagraphs: [
      { text: "I could have written a hundred of these. I stopped here so you would actually finish reading." },
      { text: "Thank you for the ordinary days, the loud car rides and the quiet bravery. I notice all of it." },
    ],
    letterSignoff: "All my love,",
  },
  fr: {
    toName: "Hana",
    fromName: "Théo",
    reasons: [
      { text: "Ta façon de rire de tes propres blagues, avant même d'arriver à la chute." },
      { text: "Ta façon de rendre un mardi ordinaire digne d'être retenu.", memory: "Des crêpes au dîner, mars 2025." },
      { text: "Tu dis encore bonjour comme si tu le pensais vraiment. Chaque jour." },
      { text: "Ta façon de chanter en voiture, fort et un peu faux." },
      { text: "Tu me donnes envie d'être plus doux, plus calme et plus courageux, simplement en étant toi." },
    ],
    finaleLine: "Et la raison avant toutes les autres : tu es toi. Je te choisis, à chaque fois.",
    letterGreeting: "Hana,",
    letterParagraphs: [
      { text: "J'aurais pu en écrire cent. Je me suis arrêté ici pour que tu lises vraiment jusqu'au bout." },
      { text: "Merci pour les jours ordinaires, les trajets bruyants en voiture et le courage discret. Je remarque tout." },
    ],
    letterSignoff: "Avec tout mon amour,",
  },
  ar: {
    toName: "ليلى",
    fromName: "سامي",
    reasons: [
      { text: "طريقتك في الضحك على نكاتك قبل أن تصلي إلى نهايتها." },
      { text: "كيف تجعلين أيام الثلاثاء العادية تستحق أن تُذكر.", memory: "فطائر على العشاء، مارس 2025." },
      { text: "ما زلتِ تقولين صباح الخير وكأنكِ تعنينها حقًا. كل يوم." },
      { text: "طريقتك في الغناء في السيارة، بصوت عالٍ ونغمة خاطئة قليلًا." },
      { text: "أنكِ تجعلينني أرغب في أن أكون ألطف وأهدأ وأشجع، فقط لأنكِ أنتِ." },
    ],
    finaleLine: "والسبب الأهم من كل ذلك: أنكِ أنتِ. أختاركِ في كل مرة.",
    letterGreeting: "ليلى،",
    letterParagraphs: [
      { text: "كان بإمكاني أن أكتب مئة سبب. توقفت هنا كي تقرئي حتى النهاية." },
      { text: "شكرًا على الأيام العادية، ورحلات السيارة الصاخبة، والشجاعة الهادئة. ألاحظ كل ذلك." },
    ],
    letterSignoff: "مع كل حبي،",
  },
};

export function createInitialState(locale?: string): ReasonsValues {
  const example = EXAMPLES[exampleLocale(locale)];
  return {
    toName: example.toName,
    fromName: example.fromName,
    title: "",
    reasons: example.reasons.map((reason) => ({ ...reason })),
    finaleTeaser: "",
    finaleLine: example.finaleLine,
    signature: "",
    letterEnabled: true,
    letterGreeting: example.letterGreeting,
    letterParagraphs: example.letterParagraphs.map((paragraph) => ({ ...paragraph })),
    letterSignoff: example.letterSignoff,
    music: true,
    showShare: true,
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return { gift: DEFAULT_GIFT };
}
