import type { ThemeSelections } from "@/types/studio";
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
export function createInitialState(): ReasonsValues {
  return {
    toName: "Hana",
    fromName: "Theo",
    title: "",
    reasons: [
      { text: "The way you laugh at your own jokes, before you even reach the punchline." },
      { text: "How you make ordinary Tuesdays feel like something worth remembering.", memory: "Pancakes for dinner, March 2025." },
      { text: "You still say good morning like you mean it. Every single day." },
      { text: "The way you sing in the car, loudly and slightly wrong." },
      { text: "That you make me want to be kinder, calmer and braver, just by being you." },
    ],
    finaleTeaser: "",
    finaleLine: "And the reason above all: you are you. I choose you, every time.",
    signature: "",
    letterEnabled: true,
    letterGreeting: "Hana,",
    letterParagraphs: [
      { text: "I could have written a hundred of these. I stopped here so you would actually finish reading." },
      { text: "Thank you for the ordinary days, the loud car rides and the quiet bravery. I notice all of it." },
    ],
    letterSignoff: "All my love,",
    music: true,
    showShare: true,
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return { gift: DEFAULT_GIFT };
}
