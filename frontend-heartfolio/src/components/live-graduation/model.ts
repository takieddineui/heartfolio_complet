import { personColorHex, personEmojiGlyph } from "@/lib/studio/product-modules/graduation-keepsake/palette";

/**
 * The view-model every journey draws from: ONE story, however it is told.
 *
 * `buildStory` reads the same flat `values` the Studio form produces and the
 * live endpoint returns (media as `{ url }`), so the purchased page and the
 * Studio's Live tab are one code path. It is deliberately forgiving - the
 * Studio feeds it half-typed data on every keystroke - and deliberately
 * strict about two things: an item with nothing in it is dropped (an empty
 * achievement slot must not draw an empty stamp), and a switched-off chapter
 * is absent, not hidden.
 */

export type Lang = "en" | "fr" | "ar";
export const LANGS: readonly Lang[] = ["en", "fr", "ar"];

export type ChapterId = "path" | "achievements" | "messages" | "goals" | "letter";
/** Fixed display order. The spec's "drag to reorder" is not in v1. */
export const CHAPTER_ORDER: readonly ChapterId[] = ["path", "achievements", "messages", "goals", "letter"];

export interface StoryStop {
  year: string;
  caption: string;
  photo?: string;
  code: string;
}

export interface StoryPerson {
  name: string;
  /** Resolved from the palette allowlist; never a raw value from `values`. */
  color: string;
  emoji: string;
  message: string;
  voiceUrl?: string;
  drawingUrl?: string;
}

export interface Story {
  lang: Lang;
  dir: "ltr" | "rtl";
  /** BCP-47 tag used for dates and numbers. */
  dateLocale: string;
  chapters: ChapterId[];
  grad: {
    name: string;
    fullName: string;
    degree: string;
    school: string;
    year: number | null;
    dateLabel: string;
    photo?: string;
  };
  path: {
    then: { year: string; text: string; photo?: string };
    stops: StoryStop[];
    now: { year: string; text: string };
    next: { text: string; photo?: string };
  };
  achievements: { title: string; detail: string; place: string }[];
  messageGroups: { label: string; people: StoryPerson[] }[];
  goals: { text: string; code: string }[];
  letter: { greeting: string; body: string[]; signoff: string; signatures: string[] };
  ending: { line: string; sub: string };
  options: { sound: boolean; share: boolean; branding: boolean };
  flight: {
    airline: string;
    number: string;
    seat: string;
    cabin: string;
    fromCode: string;
    fromPlace: string;
    toCode: string;
    toPlace: string;
  };
}

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter(isDict) : []);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const code = (v: unknown): string => {
  const c = str(v).toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "";
};

/** The `url` of a media value, or undefined. Studio state and the live
 * payload both use `{ url }`; a bare string is accepted too. */
export function mediaUrl(v: unknown): string | undefined {
  if (typeof v === "string") return v || undefined;
  if (isDict(v) && typeof v.url === "string" && v.url) return v.url;
  return undefined;
}

const DATE_LOCALES: Record<Lang, string> = { en: "en-GB", fr: "fr-FR", ar: "ar" };

export function resolveLang(valuesLanguage: unknown, localeFallback: string): Lang {
  if (typeof valuesLanguage === "string" && (LANGS as readonly string[]).includes(valuesLanguage)) {
    return valuesLanguage as Lang;
  }
  const short = localeFallback.slice(0, 2);
  return (LANGS as readonly string[]).includes(short) ? (short as Lang) : "en";
}

/** `{name}` / `{n}` / `{t}` substitution. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

export function buildStory(values: Dict, localeFallback: string): Story {
  const lang = resolveLang(values.language, localeFallback);
  const dateLocale = DATE_LOCALES[lang];

  const chapterOn: Record<ChapterId, boolean> = {
    path: flag(values.showPath, true),
    achievements: flag(values.showAchievements, true),
    messages: flag(values.showMessages, true),
    goals: flag(values.showGoals, true),
    letter: flag(values.showLetter, true),
  };

  const iso = str(values.gradDate).slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : null;
  const validDate = parsed !== null && !Number.isNaN(parsed.valueOf());

  const stops: StoryStop[] = list(values.stops)
    .map((s) => ({ year: str(s.year), caption: str(s.caption), photo: mediaUrl(s.photo), code: code(s.code) }))
    .filter((s) => s.caption || s.year || s.photo);

  const messageGroups = list(values.messageGroups)
    .map((g) => ({
      label: str(g.label),
      people: list(g.people)
        .map(
          (p): StoryPerson => ({
            name: str(p.name),
            color: personColorHex(str(p.color)),
            emoji: personEmojiGlyph(str(p.emoji)),
            message: typeof p.message === "string" ? p.message.trim() : "",
            voiceUrl: mediaUrl(p.voice),
            drawingUrl: mediaUrl(p.drawing),
          })
        )
        .filter((p) => p.name || p.message),
    }))
    .filter((g) => g.people.length > 0);

  return {
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    dateLocale,
    chapters: CHAPTER_ORDER.filter((id) => chapterOn[id]),
    grad: {
      name: str(values.gradName),
      fullName: str(values.gradFullName) || str(values.gradName),
      degree: str(values.gradDegree),
      school: str(values.gradSchool),
      year: validDate ? parsed.getFullYear() : null,
      dateLabel: validDate
        ? new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "long", year: "numeric" }).format(parsed)
        : "",
      photo: mediaUrl(values.gradPhoto),
    },
    path: {
      then: { year: str(values.thenYear), text: str(values.thenText), photo: mediaUrl(values.thenPhoto) },
      stops,
      now: { year: str(values.nowYear), text: str(values.nowText) },
      next: { text: str(values.nextText), photo: mediaUrl(values.nextPhoto) },
    },
    achievements: list(values.achievements)
      .map((a) => ({ title: str(a.title), detail: str(a.detail), place: str(a.place) }))
      .filter((a) => a.title)
      .slice(0, 10),
    messageGroups,
    goals: list(values.goals)
      .map((g) => ({ text: str(g.text), code: code(g.code) }))
      .filter((g) => g.text),
    letter: {
      greeting: str(values.letterGreeting),
      body: list(values.letterBody)
        .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
        .filter(Boolean),
      signoff: str(values.letterSignoff),
      signatures: list(values.letterSignatures)
        .map((s) => str(s.name))
        .filter(Boolean),
    },
    ending: { line: str(values.endingLine), sub: str(values.endingSub) },
    options: {
      sound: flag(values.soundEnabled, true),
      share: flag(values.shareEnabled, true),
      branding: flag(values.brandingShow, true),
    },
    flight: {
      airline: str(values.flightAirline),
      number: str(values.flightNumber),
      seat: str(values.flightSeat),
      cabin: str(values.flightCabin),
      fromCode: code(values.flightFromCode),
      fromPlace: str(values.flightFromPlace),
      toCode: code(values.flightToCode),
      toPlace: str(values.flightToPlace),
    },
  };
}
