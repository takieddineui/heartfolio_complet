import type { ThemeSelections } from "@/types/studio";
import { DEFAULT_JOURNEY } from "./journeys";
import { DEFAULT_PERSON_COLOR, DEFAULT_PERSON_EMOJI } from "./palette";

/** A picked or uploaded file, exactly as `media-values.ts` handles it: `url`
 * is a local preview (a blob) or a presigned display URL and is NEVER
 * persisted as the reference; `assetId` is the durable one, stamped in at
 * checkout. */
export interface GraduationMedia {
  url: string;
  mimeType: string;
  filename: string;
  assetId?: string;
}

export interface GraduationStop {
  year: string;
  caption: string;
  photo?: GraduationMedia;
  /** Airline journey only: three letters printed on the flight path. */
  code?: string;
}

export interface GraduationAchievement {
  title: string;
  detail?: string;
  /** Airline journey only: printed on the passport stamp. */
  place?: string;
}

export interface GraduationPerson {
  name: string;
  /** An id from `palette.ts`, never a hex code. */
  color: string;
  /** An id from `palette.ts`, never an emoji character. */
  emoji: string;
  message: string;
  voice?: GraduationMedia;
  drawing?: GraduationMedia;
}

export interface GraduationMessageGroup {
  label: string;
  people: GraduationPerson[];
}

export interface GraduationGoal {
  text: string;
  /** Airline journey only. */
  code?: string;
}

/** The whole story, flat - the keys ARE the field ids in `schema.ts` and the
 * keys the backend's `data.py` reads. The journey is not here: it is
 * `themeSelections.journey`, because it decides how the story is told and not
 * what the story says. */
export interface GraduationValues {
  language: "en" | "fr" | "ar";
  showPath: boolean;
  showAchievements: boolean;
  showMessages: boolean;
  showGoals: boolean;
  showLetter: boolean;

  gradName: string;
  gradFullName: string;
  gradDegree: string;
  gradSchool: string;
  /** ISO date, `YYYY-MM-DD`. The graduation year is derived from it. */
  gradDate: string;
  gradPhoto?: GraduationMedia;

  thenYear: string;
  thenText: string;
  thenPhoto?: GraduationMedia;
  stops: GraduationStop[];
  nowYear: string;
  nowText: string;
  nextText: string;
  nextPhoto?: GraduationMedia;

  achievements: GraduationAchievement[];
  messageGroups: GraduationMessageGroup[];
  goals: GraduationGoal[];

  letterGreeting: string;
  letterBody: { text: string }[];
  letterSignoff: string;
  letterSignatures: { name: string }[];

  endingLine: string;
  endingSub: string;
  soundEnabled: boolean;
  shareEnabled: boolean;
  brandingShow: boolean;

  // Airline journey only: what is printed on the boarding pass.
  flightAirline: string;
  flightNumber: string;
  flightSeat: string;
  flightCabin: string;
  flightFromCode: string;
  flightFromPlace: string;
  flightToCode: string;
  flightToPlace: string;
}

export function createInitialPerson(): GraduationPerson {
  return { name: "", color: DEFAULT_PERSON_COLOR, emoji: DEFAULT_PERSON_EMOJI, message: "" };
}

export function createInitialState(): GraduationValues {
  return {
    language: "en",
    showPath: true,
    showAchievements: true,
    showMessages: true,
    showGoals: true,
    showLetter: true,

    gradName: "",
    gradFullName: "",
    gradDegree: "",
    gradSchool: "",
    gradDate: "",

    thenYear: "",
    thenText: "",
    stops: [{ year: "", caption: "" }],
    nowYear: "",
    nowText: "",
    nextText: "",

    achievements: [{ title: "" }],
    messageGroups: [{ label: "", people: [createInitialPerson()] }],
    goals: [{ text: "" }],

    letterGreeting: "",
    letterBody: [{ text: "" }],
    letterSignoff: "",
    letterSignatures: [{ name: "" }],

    endingLine: "",
    endingSub: "",
    soundEnabled: true,
    shareEnabled: true,
    brandingShow: true,

    flightAirline: "",
    flightNumber: "",
    flightSeat: "",
    flightCabin: "",
    flightFromCode: "",
    flightFromPlace: "",
    flightToCode: "",
    flightToPlace: "",
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return { journey: DEFAULT_JOURNEY };
}
