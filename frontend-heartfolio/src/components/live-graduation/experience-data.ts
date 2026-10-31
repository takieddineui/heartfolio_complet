import { resolveModuleText } from "@/lib/studio/i18n";
import type { GraduationValues } from "@/lib/studio/product-modules/graduation-keepsake/initial-state";
import { colourFor, journeyOrDefault, type JourneyId } from "@/lib/studio/product-modules/graduation-keepsake/journeys";
import { GRADUATION_LIMITS as L } from "@/lib/studio/product-modules/graduation-keepsake/limits";
import { graduationMessages } from "@/lib/studio/product-modules/graduation-keepsake/messages";
import type { LocaleCode, ThemeSelections } from "@/types/studio";
import type { LivePhoto } from "@/components/live/live-photo";

/**
 * WHAT THE EXPERIENCE DRAWS, in one shape for both of its homes: the Studio's
 * live preview (built from the form values, below) and the purchased
 * `/live/<id>` page (built by the backend's `build_graduation_live_payload`,
 * which returns exactly this shape with fresh, ownership-checked media URLs).
 * A chapter switched off is `null`.
 */
/** A photo, drawing or voice message. Photos and drawings from the live
 * payload also carry their web copies and size (`live-photo.ts`). */
export type Media = (LivePhoto & { url: string }) | null;

export interface ExperienceStop {
  year: string;
  caption: string;
  code: string;
  photo: Media;
}

export interface ExperiencePerson {
  name: string;
  /** A palette id, or empty for "by position". */
  color: string;
  emoji: string;
  message: string;
  voice: Media;
  voiceCaption: string;
  drawing: Media;
}

export interface GraduationExperienceData {
  journey: JourneyId;
  grad: { name: string; fullName: string; year: string; degree: string; school: string; date: string; photo: Media };
  path: {
    then: { year: string; text: string; photo: Media };
    stops: ExperienceStop[];
    now: { year: string; text: string };
    next: { text: string; photo: Media };
  } | null;
  achievements: { title: string; detail: string; place: string }[] | null;
  messages: { label: string; people: ExperiencePerson[] }[] | null;
  goals: { text: string; code: string }[] | null;
  letter: { greeting: string; paragraphs: string[]; signoff: string; signatures: string[] } | null;
  ending: { line: string; sub: string };
  flight: {
    airline: string;
    number: string;
    seat: string;
    cabin: string;
    fromCode: string;
    fromCity: string;
    toCode: string;
    toCity: string;
  };
  sound: boolean;
  share: boolean;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const media = (value: unknown): Media => {
  const url = value && typeof value === "object" ? (value as { url?: unknown }).url : null;
  return typeof url === "string" && url ? { url } : null;
};
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const code = (value: unknown) => text(value).toUpperCase();

/** The Studio's flat form values, as the experience draws them. Mirrors the
 * backend's normalization: empty items are dropped, caps applied, and the
 * airline-only fields are blank on every other journey. */
export function experienceFromStudio(values: GraduationValues, themeSelections: ThemeSelections): GraduationExperienceData {
  const journey = journeyOrDefault(themeSelections.journey);
  const airline = journey === "airline";
  return {
    journey,
    grad: {
      name: text(values.gradName),
      fullName: text(values.gradFullName),
      year: text(values.gradYear),
      degree: text(values.gradDegree),
      school: text(values.gradSchool),
      date: text(values.gradDate),
      photo: media(values.gradPhoto),
    },
    path: values.pathEnabled
      ? {
          then: { year: text(values.thenYear), text: text(values.thenText), photo: media(values.thenPhoto) },
          stops: list<GraduationValues["stops"][number]>(values.stops)
            .filter((stop) => text(stop?.caption) || text(stop?.year))
            .slice(0, L.maxStops)
            .map((stop) => ({ year: text(stop.year), caption: text(stop.caption), code: airline ? code(stop.code) : "", photo: media(stop.photo) })),
          now: { year: text(values.nowYear), text: text(values.nowText) },
          next: { text: text(values.nextText), photo: media(values.nextPhoto) },
        }
      : null,
    achievements: values.achievementsEnabled
      ? list<GraduationValues["achievements"][number]>(values.achievements)
          .filter((a) => text(a?.title))
          .slice(0, L.maxAchievements)
          .map((a) => ({ title: text(a.title), detail: text(a.detail), place: airline ? text(a.place) : "" }))
      : null,
    messages: values.messagesEnabled
      ? list<GraduationValues["messageGroups"][number]>(values.messageGroups)
          .slice(0, L.maxGroups)
          .map((group) => ({
            label: text(group?.label),
            people: list<GraduationValues["messageGroups"][number]["people"][number]>(group?.people)
              .filter((p) => text(p?.name) || text(p?.message))
              .slice(0, L.maxPeople)
              .map((p) => ({
                name: text(p.name),
                color: text(p.color),
                emoji: text(p.emoji),
                message: text(p.message),
                voice: media(p.voice),
                voiceCaption: media(p.voice) ? text(p.voiceCaption) : "",
                drawing: media(p.drawing),
              })),
          }))
          .filter((group) => group.people.length > 0)
      : null,
    goals: values.goalsEnabled
      ? list<GraduationValues["goals"][number]>(values.goals)
          .filter((g) => text(g?.text))
          .slice(0, L.maxGoals)
          .map((g) => ({ text: text(g.text), code: airline ? code(g.code) : "" }))
      : null,
    letter: values.letterEnabled
      ? {
          greeting: text(values.letterGreeting),
          paragraphs: list<{ text: string }>(values.letterParagraphs).map((p) => text(p?.text)).filter(Boolean),
          signoff: text(values.letterSignoff),
          signatures: list<{ name: string }>(values.letterSignatures).map((s) => text(s?.name)).filter(Boolean),
        }
      : null,
    ending: { line: text(values.endingLine), sub: text(values.endingSub) },
    flight: {
      airline: airline ? text(values.flightAirline) : "",
      number: airline ? text(values.flightNumber) : "",
      seat: airline ? text(values.flightSeat) : "",
      cabin: airline ? text(values.flightCabin) : "",
      fromCode: airline ? code(values.flightFromCode) : "",
      fromCity: airline ? text(values.flightFromCity) : "",
      toCode: airline ? code(values.flightToCode) : "",
      toCity: airline ? text(values.flightToCity) : "",
    },
    sound: values.sound !== false,
    share: values.showShare !== false,
  };
}

export function localeOf(locale: string): LocaleCode {
  return (locale in graduationMessages ? locale : "en") as LocaleCode;
}

export function translatorFor(locale: string) {
  const code = localeOf(locale);
  return (key: string, params?: Record<string, string | number>) => resolveModuleText(key, code, graduationMessages, params);
}

/** Numbers the experience GENERATES (counts, altitudes, stages, the score) in
 * the reader's own digits: Arabic is set explicitly to Arabic-Indic, as on
 * Reasons I Love You, so the same keepsake does not vary by device. What the
 * creator typed (years, names) is always shown exactly as typed. */
export function formatNumber(value: number, locale: string, grouping = true): string {
  const code = localeOf(locale);
  return new Intl.NumberFormat(code, { useGrouping: grouping, ...(code === "ar" ? { numberingSystem: "arab" } : {}) }).format(value);
}

/** The graduation date, in the reader's language ("2 Jul 2027", "٢ يوليو ٢٠٢٧").
 * Noon UTC, so no timezone can move it to the day before. */
export function formatDate(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const code = localeOf(locale);
  try {
    return new Intl.DateTimeFormat(code, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
      ...(code === "ar" ? { numberingSystem: "arab" } : {}),
    }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

/** A person's colour: theirs, or one by position so cards stay distinct. */
export function personColour(person: Pick<ExperiencePerson, "color">, position: number): string {
  return colourFor(person.color, position);
}

/** The boarding pass with every empty field filled from the journey's own
 * translated defaults (the prototype had none: an empty field printed
 * nothing). Codes default to KID and NXT; the flight number to "NC" and the
 * graduation year. */
export function flightOf(data: GraduationExperienceData, t: ReturnType<typeof translatorFor>) {
  const f = data.flight;
  return {
    airline: f.airline || t("journeys.airline.defaultAirline"),
    number: f.number || `NC ${data.grad.year}`.trim(),
    seat: f.seat || "1A",
    cabin: f.cabin || t("journeys.airline.defaultCabin"),
    fromCode: f.fromCode || "KID",
    fromCity: f.fromCity || t("journeys.airline.defaultFrom"),
    toCode: f.toCode || "NXT",
    toCity: f.toCity || t("journeys.airline.defaultTo"),
  };
}

/** The summit journey's height: Mont Blanc's, the prototype's own top. */
export const SUMMIT_METRES = 4808;

/** Altitudes along the trail, ALWAYS CLIMBING: base camp 0, every stop evenly
 * between, and "Now" at the summit. The prototype gave stop N (N+1) x 800 m,
 * so twelve stops climbed to 9,600 m and then "Summit" said 4,000 m. Rounded
 * to 50 m, as a trail sign would be. */
export function trailAltitudes(stopCount: number): { then: number; stops: number[]; now: number } {
  const step = SUMMIT_METRES / (stopCount + 1);
  return {
    then: 0,
    stops: Array.from({ length: stopCount }, (_, i) => Math.round((step * (i + 1)) / 50) * 50),
    now: SUMMIT_METRES,
  };
}

/** The ridges achievements are planted on, evenly below the summit (the
 * prototype's (i+1) x 500 m put the tenth flag at 5,000 m, above the top). */
export function ridgeAltitudes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((SUMMIT_METRES * (i + 1)) / (count + 1) / 50) * 50);
}

/** The arcade's final score from the graduation YEAR (the prototype always
 * used 2027) and the achievements: year x 100 + 1,000 per achievement. */
export function arcadeScore(data: GraduationExperienceData): number {
  const year = Number.parseInt(data.grad.year, 10);
  return (Number.isFinite(year) ? year : 0) * 100 + (data.achievements?.length ?? 0) * 1000;
}

/** The text a person's message card speaks with, a grapheme at a time
 * (`Intl.Segmenter`): stepping by UTF-16 unit, as the prototype did, split an
 * emoji into two broken halves for a moment. One growing text node keeps
 * Arabic letters joined at every step. */
export function graphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((part) => part.segment);
  }
  return [...value];
}
