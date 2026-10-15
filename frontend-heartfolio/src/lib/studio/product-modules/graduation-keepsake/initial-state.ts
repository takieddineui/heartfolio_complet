import type { ThemeSelections } from "@/types/studio";
import { DEFAULT_JOURNEY } from "./journeys";

/** A photo, drawing or voice message as the Studio stores it: `assetId` once
 * uploaded, `url` for the preview. The backend trusts only `assetId`. */
export interface GraduationMedia {
  url: string;
  mimeType?: string;
  filename?: string;
  assetId?: string;
}

export interface Stop {
  year: string;
  caption: string;
  /** Three letters; used by the airline journey only. */
  code?: string;
  photo?: GraduationMedia | null;
}

export interface Achievement {
  title: string;
  detail?: string;
  /** Printed on the airline journey's passport stamp. */
  place?: string;
}

export interface Person {
  name: string;
  /** A palette id (`journeys.ts`); empty means by position. */
  color?: string;
  emoji?: string;
  message: string;
  voice?: GraduationMedia | null;
  /** Untimed: shown beside the voice message while it plays. */
  voiceCaption?: string;
  drawing?: GraduationMedia | null;
}

export interface MessageGroup {
  label: string;
  people: Person[];
}

export interface Goal {
  text: string;
  /** Three letters; used by the airline journey only. */
  code?: string;
}

/**
 * The customer's inputs, flat by field id (the Studio's form is keyed that
 * way). The prototype's nested `GRAD` object maps onto this. Deliberately
 * absent (v1 scope, see the module's `index.ts`): the reply and its quick
 * reactions, `meta.id`, the date-format region (follows the language), the
 * chapter order (fixed), the branding switch (always shown), a send date and a
 * collection link.
 */
export interface GraduationValues {
  gradName: string;
  gradFullName: string;
  /** Four digits, kept as typed. */
  gradYear: string;
  gradDegree: string;
  gradSchool: string;
  /** `YYYY-MM-DD`. */
  gradDate: string;
  gradPhoto: GraduationMedia | null;

  pathEnabled: boolean;
  thenYear: string;
  thenText: string;
  thenPhoto: GraduationMedia | null;
  stops: Stop[];
  nowYear: string;
  nowText: string;
  nextText: string;
  nextPhoto: GraduationMedia | null;

  achievementsEnabled: boolean;
  achievements: Achievement[];

  messagesEnabled: boolean;
  messageGroups: MessageGroup[];

  goalsEnabled: boolean;
  goals: Goal[];

  letterEnabled: boolean;
  letterGreeting: string;
  letterParagraphs: { text: string }[];
  letterSignoff: string;
  letterSignatures: { name: string }[];

  endingLine: string;
  endingSub: string;

  /** The boarding pass; airline journey only. Empty falls back to the
   * journey's own translated defaults. */
  flightAirline: string;
  flightNumber: string;
  flightSeat: string;
  flightCabin: string;
  flightFromCode: string;
  flightFromCity: string;
  flightToCode: string;
  flightToCity: string;

  sound: boolean;
  showShare: boolean;
}

/** English example content, as every product's Studio opens with: the
 * prototype's own Maya Chen. No photos (those are the customer's). */
export function createInitialState(): GraduationValues {
  return {
    gradName: "Maya",
    gradFullName: "Maya Chen",
    gradYear: "2027",
    gradDegree: "BA (Hons) Architecture",
    gradSchool: "University of Edinburgh",
    gradDate: "2027-07-02",
    gradPhoto: null,

    pathEnabled: true,
    thenYear: "2005",
    thenText: "A five-year-old who drew houses on every wall in the flat.",
    thenPhoto: null,
    stops: [
      { year: "2010", caption: "First day of school", code: "SCH" },
      { year: "2014", caption: "The Lego city phase", code: "LEG" },
      { year: "2018", caption: "Art prize, age 13", code: "ART" },
      { year: "2023", caption: "Studio all-nighter no. 47", code: "UNI" },
    ],
    nowYear: "2027",
    nowText: "An architect, with a first-class degree to prove it.",
    nextText: "A junior designer role at a studio in Copenhagen, starting in September.",
    nextPhoto: null,

    achievementsEnabled: true,
    achievements: [
      { title: "First-class honours", detail: "Top of the year in design studio", place: "EDINBURGH" },
      { title: "Dean's list", detail: "Three years running", place: "ACADEMIA" },
      { title: "RIBA award shortlist", detail: "For the riverside library", place: "LONDON" },
      { title: "Exchange year", detail: "And surprisingly good Danish", place: "COPENHAGEN" },
      { title: "Society president", detail: "Forty sketchers, one sketchbook", place: "STUDIO 4" },
      { title: "47 all-nighters", detail: "Fuelled entirely by toast", place: "THE LIBRARY" },
    ],

    messagesEnabled: true,
    messageGroups: [
      {
        label: "From home",
        people: [
          { name: "Mum", color: "coral", emoji: "🏡", message: "I still have every drawing you ever stuck on the fridge. Now I get to see your buildings on real streets. I am so, so proud of you." },
          { name: "Dad", color: "sky", emoji: "☕", message: "You worked harder than anyone I know, and you stayed kind while you did it. That's the real achievement. Well done, kiddo." },
          { name: "Kai", color: "amber", emoji: "🌳", message: "Can you design me a treehouse with a slide. And a zip line. Well done Maya." },
        ],
      },
      {
        label: "From friends",
        people: [
          { name: "Jonah", color: "mint", emoji: "✏️", message: "Four years of sharing a desk, a kettle and about a thousand deadlines. Copenhagen has no idea what is coming. So proud of you!" },
          { name: "Priya", color: "berry", emoji: "🎉", message: "You're the only person I know who sketches the queue at the supermarket. Never stop. Love you, superstar." },
          { name: "Sam", color: "violet", emoji: "🏫", message: "From drawing on the walls to designing actual walls. Ten-year-old me would be very impressed." },
        ],
      },
    ],

    goalsEnabled: true,
    goals: [
      { text: "Start at the studio in Copenhagen", code: "CPH" },
      { text: "Become a fully qualified architect", code: "ARB" },
      { text: "Learn to cycle in Copenhagen without getting lost", code: "BKE" },
      { text: "Build Kai that treehouse", code: "TRE" },
      { text: "Visit every Alvar Aalto building", code: "AAL" },
    ],

    letterEnabled: true,
    letterGreeting: "Dear Maya,",
    letterParagraphs: [
      { text: "Today you are wearing a cap and gown, but we still see the little girl with crayon all over her hands, explaining exactly where the front door of her house would go." },
      { text: "You did this through late nights, hard days and more toast than any person should eat. We could not be prouder of who you have become." },
      { text: "The world is about to get a little more beautiful. Go and build it." },
    ],
    letterSignoff: "With all our love,",
    letterSignatures: [{ name: "Mum" }, { name: "Dad" }, { name: "Kai" }],

    endingLine: "Congratulations, Maya!",
    endingSub: "Your next chapter starts now.",

    flightAirline: "",
    flightNumber: "",
    flightSeat: "",
    flightCabin: "",
    flightFromCode: "",
    flightFromCity: "",
    flightToCode: "",
    flightToCity: "",

    sound: true,
    showShare: true,
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return { journey: DEFAULT_JOURNEY };
}
