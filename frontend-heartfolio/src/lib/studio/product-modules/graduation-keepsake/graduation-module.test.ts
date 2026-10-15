import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendRoot } from "../../../../../test/backend-root";
import { experienceFromStudio } from "@/components/live-graduation/experience-data";
import { formEngine } from "@/lib/studio/form-engine";
import { getAllProductsIncludingHidden, getProductBySlug } from "@/lib/products/registry";
import type { FieldSchema, GroupFieldSchema } from "@/types/studio";
import { graduationKeepsakeModule } from "./index";
import { createInitialState, createInitialThemeSelections, type GraduationValues } from "./initial-state";
import { COLOUR_IDS, DEFAULT_JOURNEY, JOURNEY_IDS } from "./journeys";
import { GRADUATION_LIMITS as L } from "./limits";
import { graduationMessages } from "./messages";
import { countMedia, graduationSchema } from "./schema";
import { validateGraduation } from "./validation";

/**
 * GRADUATION KEEPSAKE'S STUDIO MODULE, pinned to the backend's contract.
 *
 * The backend (`graduation_keepsake/data.py`) is the gate; this module is the
 * customer's guide. If a number, a journey or a colour differs between them, a
 * project the Studio accepts is refused at checkout, or the reverse.
 */
const DATA_PY = readFileSync(join(backendRoot(), "apps", "delivery", "product_renderers", "graduation_keepsake", "data.py"), "utf8");
const py = (name: string) => {
  const match = DATA_PY.match(new RegExp(`^${name} = (\\d+)$`, "m"));
  if (!match) throw new Error(`${name} not found in data.py`);
  return Number(match[1]);
};
const pyTuple = (name: string) => [...DATA_PY.match(new RegExp(`^${name} = \\(([^)]*)\\)`, "m"))![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const PAIRS: [keyof typeof L, string][] = [
  ["nameMaxLength", "NAME_MAX_LENGTH"],
  ["fullNameMaxLength", "FULL_NAME_MAX_LENGTH"],
  ["degreeMaxLength", "DEGREE_MAX_LENGTH"],
  ["schoolMaxLength", "SCHOOL_MAX_LENGTH"],
  ["pathYearMaxLength", "PATH_YEAR_MAX_LENGTH"],
  ["pathTextMaxLength", "PATH_TEXT_MAX_LENGTH"],
  ["stopCaptionMaxLength", "STOP_CAPTION_MAX_LENGTH"],
  ["minStops", "MIN_STOPS"],
  ["maxStops", "MAX_STOPS"],
  ["minAchievements", "MIN_ACHIEVEMENTS"],
  ["maxAchievements", "MAX_ACHIEVEMENTS"],
  ["achievementTitleMaxLength", "ACHIEVEMENT_TITLE_MAX_LENGTH"],
  ["achievementDetailMaxLength", "ACHIEVEMENT_DETAIL_MAX_LENGTH"],
  ["achievementPlaceMaxLength", "ACHIEVEMENT_PLACE_MAX_LENGTH"],
  ["minGroups", "MIN_GROUPS"],
  ["maxGroups", "MAX_GROUPS"],
  ["groupLabelMaxLength", "GROUP_LABEL_MAX_LENGTH"],
  ["minPeople", "MIN_PEOPLE"],
  ["maxPeople", "MAX_PEOPLE"],
  ["personNameMaxLength", "PERSON_NAME_MAX_LENGTH"],
  ["messageMaxLength", "MESSAGE_MAX_LENGTH"],
  ["voiceCaptionMaxLength", "VOICE_CAPTION_MAX_LENGTH"],
  ["maxVoices", "MAX_VOICES"],
  ["maxDrawings", "MAX_DRAWINGS"],
  ["minGoals", "MIN_GOALS"],
  ["maxGoals", "MAX_GOALS"],
  ["goalMaxLength", "GOAL_MAX_LENGTH"],
  ["greetingMaxLength", "GREETING_MAX_LENGTH"],
  ["minParagraphs", "MIN_PARAGRAPHS"],
  ["maxParagraphs", "MAX_PARAGRAPHS"],
  ["paragraphMaxLength", "PARAGRAPH_MAX_LENGTH"],
  ["signoffMaxLength", "SIGNOFF_MAX_LENGTH"],
  ["minSignatures", "MIN_SIGNATURES"],
  ["maxSignatures", "MAX_SIGNATURES"],
  ["signatureMaxLength", "SIGNATURE_MAX_LENGTH"],
  ["endingLineMaxLength", "ENDING_LINE_MAX_LENGTH"],
  ["endingSubMaxLength", "ENDING_SUB_MAX_LENGTH"],
  ["flightAirlineMaxLength", "FLIGHT_AIRLINE_MAX_LENGTH"],
  ["flightNumberMaxLength", "FLIGHT_NUMBER_MAX_LENGTH"],
  ["flightSeatMaxLength", "FLIGHT_SEAT_MAX_LENGTH"],
  ["flightCabinMaxLength", "FLIGHT_CABIN_MAX_LENGTH"],
  ["flightCityMaxLength", "FLIGHT_CITY_MAX_LENGTH"],
];

/** Every field in the schema, groups walked, keyed by a readable path. */
function fields(list: FieldSchema[] = graduationSchema.sections.flatMap((s) => s.fields), prefix = ""): Map<string, FieldSchema> {
  const out = new Map<string, FieldSchema>();
  for (const field of list) {
    out.set(prefix + field.id, field);
    if (field.type === "group") for (const [k, v] of fields(field.itemFields, `${prefix}${field.id}.`)) out.set(k, v);
  }
  return out;
}
const F = fields();
const maxLength = (path: string) => (F.get(path) as { maxLength?: number }).maxLength;
const group = (path: string) => F.get(path) as GroupFieldSchema;

const photo = { url: "blob:photo", assetId: "11111111-1111-1111-1111-111111111111" };
/** The opening state with its photos uploaded: what a customer submits. */
const complete = (): GraduationValues => {
  const v = createInitialState();
  v.gradPhoto = photo;
  v.thenPhoto = photo;
  v.nextPhoto = photo;
  v.stops = v.stops.map((s) => ({ ...s, photo }));
  return v;
};
const airline = { journey: "airline" };
const space = { journey: "space" };

describe("the limits match the backend's data.py", () => {
  it.each(PAIRS)("%s = %s", (front, back) => {
    expect(L[front]).toBe(py(back));
  });

  it("covers every limit on this side", () => {
    expect(PAIRS.map(([front]) => front).sort()).toEqual(Object.keys(L).filter((k) => k !== "voiceMaxSeconds").sort());
  });

  it("keeps the voice length equal to the backend's audio cap", () => {
    const media = readFileSync(join(backendRoot(), "apps", "assets", "media.py"), "utf8");
    expect(L.voiceMaxSeconds).toBe(Number(media.match(/^MAX_AUDIO_SECONDS = (\d+)$/m)![1]));
  });

  it("has the same journeys, default and colour palette", () => {
    expect([...JOURNEY_IDS]).toEqual(pyTuple("JOURNEYS"));
    expect(DATA_PY).toContain(`DEFAULT_JOURNEY = "${DEFAULT_JOURNEY}"`);
    expect([...COLOUR_IDS]).toEqual(pyTuple("COLOURS"));
  });

  it("keeps the worst-case upload count under production's 30 a minute", () => {
    // main photo, then, next, every stop, and the per-keepsake voice and drawing caps
    expect(3 + L.maxStops + L.maxVoices + L.maxDrawings).toBeLessThanOrEqual(25);
  });
});

describe("the form uses those limits", () => {
  it.each([
    ["gradName", L.nameMaxLength],
    ["gradFullName", L.fullNameMaxLength],
    ["gradDegree", L.degreeMaxLength],
    ["gradSchool", L.schoolMaxLength],
    ["thenYear", L.pathYearMaxLength],
    ["thenText", L.pathTextMaxLength],
    ["stops.caption", L.stopCaptionMaxLength],
    ["achievements.title", L.achievementTitleMaxLength],
    ["achievements.detail", L.achievementDetailMaxLength],
    ["achievements.place", L.achievementPlaceMaxLength],
    ["messageGroups.label", L.groupLabelMaxLength],
    ["messageGroups.people.name", L.personNameMaxLength],
    ["messageGroups.people.message", L.messageMaxLength],
    ["messageGroups.people.voiceCaption", L.voiceCaptionMaxLength],
    ["goals.text", L.goalMaxLength],
    ["letterGreeting", L.greetingMaxLength],
    ["letterParagraphs.text", L.paragraphMaxLength],
    ["letterSignatures.name", L.signatureMaxLength],
    ["endingLine", L.endingLineMaxLength],
    ["endingSub", L.endingSubMaxLength],
    ["flightCabin", L.flightCabinMaxLength],
  ])("%s caps at %i", (path, cap) => {
    expect(maxLength(path)).toBe(cap);
  });

  it("groups take the spec's counts", () => {
    expect([group("stops").minItems, group("stops").maxItems]).toEqual([L.minStops, L.maxStops]);
    expect([group("achievements").minItems, group("achievements").maxItems]).toEqual([L.minAchievements, L.maxAchievements]);
    expect([group("messageGroups").minItems, group("messageGroups").maxItems]).toEqual([L.minGroups, L.maxGroups]);
    expect([group("messageGroups.people").minItems, group("messageGroups.people").maxItems]).toEqual([L.minPeople, L.maxPeople]);
    expect([group("letterParagraphs").minItems, group("letterParagraphs").maxItems]).toEqual([L.minParagraphs, L.maxParagraphs]);
  });

  it("voice messages can be uploaded as well as recorded, up to a minute", () => {
    const voice = F.get("messageGroups.people.voice") as { type: string; allowUpload?: boolean; maxSeconds?: number };
    expect(voice).toMatchObject({ type: "audio", allowUpload: true, maxSeconds: 60 });
  });

  it("an emoji is one grapheme; a colour is a palette swatch", () => {
    expect(F.get("messageGroups.people.emoji")).toMatchObject({ maxGraphemes: 1 });
    expect((F.get("messageGroups.people.color") as { type: string; options: { value: string }[] }).options.map((o) => o.value)).toEqual([...COLOUR_IDS]);
  });

  it("the boarding pass and the codes are airline-only", () => {
    const flight = graduationSchema.sections.find((s) => s.id === "flight")!;
    expect(flight.visibleWhen).toEqual([{ path: "theme.journey", op: "eq", value: "airline" }]);
    for (const path of ["stops.code", "goals.code", "achievements.place"]) {
      expect(F.get(path)!.visibleWhen, path).toEqual([{ path: "theme.journey", op: "eq", value: "airline" }]);
    }
  });

  it("a new message group starts with one empty person, not below its minimum", () => {
    expect(group("messageGroups.people").defaultValue).toEqual([{ name: "", message: "" }]);
  });

  it("counts voice messages across every group for the help text", () => {
    const v = complete();
    v.messageGroups[0]!.people[0]!.voice = photo;
    v.messageGroups[1]!.people[2]!.voice = photo;
    expect(countMedia(v as unknown as Record<string, unknown>, "voice")).toBe(2);
    const help = (F.get("messageGroups.people.voice") as { helpTextParams: (values: Record<string, unknown>) => object }).helpTextParams;
    expect(help(v as unknown as Record<string, unknown>)).toEqual({ used: 2, max: 5 });
  });
});

describe("validation", () => {
  const all = (values: GraduationValues, theme = airline) => {
    const generic = formEngine.validate(graduationSchema, values, theme);
    const domain = validateGraduation(values, theme);
    return { ...generic.errors, ...domain.errors };
  };

  it("the opening state is complete once its photos are uploaded", () => {
    expect(all(complete())).toEqual({});
    expect(createInitialThemeSelections()).toEqual({ journey: "airline" });
  });

  it("without photos, exactly the required photos are missing", () => {
    expect(Object.keys(all(createInitialState())).sort()).toEqual(
      ["gradPhoto", "nextPhoto", "stops.0.photo", "stops.1.photo", "stops.2.photo", "stops.3.photo", "thenPhoto"].sort()
    );
  });

  it("a chapter switched off blocks nothing", () => {
    const v = complete();
    Object.assign(v, { pathEnabled: false, thenPhoto: null, stops: [], achievementsEnabled: false, achievements: [], messagesEnabled: false, messageGroups: [], goalsEnabled: false, goals: [], letterEnabled: false, letterGreeting: "", letterSignatures: [] });
    expect(all(v)).toEqual({});
  });

  it("refuses a year, a date and a code that are not real", () => {
    const v = complete();
    v.gradYear = "27";
    v.gradDate = "2027-02-30";
    v.goals[0]!.code = "C1";
    const errors = all(v);
    expect(errors.gradYear).toMatchObject({ code: "year" });
    expect(errors.gradDate).toMatchObject({ code: "date" });
    expect(errors["goals.0.code"]).toMatchObject({ code: "airportCode" });
  });

  it("ignores a bad code on another journey, where the field is hidden", () => {
    const v = complete();
    v.goals[0]!.code = "C1";
    v.flightFromCode = "??";
    expect(all(v, space)).toEqual({});
  });

  it("flags the sixth voice message and the sixth drawing, wherever they are", () => {
    const v = complete();
    const everyone = v.messageGroups.flatMap((g) => g.people);
    everyone.forEach((p) => {
      p.voice = photo;
      p.drawing = photo;
    });
    const errors = all(v);
    expect(Object.keys(errors).filter((k) => k.endsWith(".voice"))).toEqual(["messageGroups.1.people.2.voice"]);
    expect(Object.keys(errors).filter((k) => k.endsWith(".drawing"))).toEqual(["messageGroups.1.people.2.drawing"]);
    everyone[5]!.voice = null;
    everyone[5]!.drawing = null;
    expect(all(v)).toEqual({});
  });

  it("one emoji, counted as a reader counts it", () => {
    const v = complete();
    v.messageGroups[0]!.people[0]!.emoji = "👨‍👩‍👧‍👦";
    expect(all(v)).toEqual({});
    v.messageGroups[0]!.people[0]!.emoji = "🎓🎉";
    expect(all(v)["messageGroups.0.people.0.emoji"]).toMatchObject({ code: "maxGraphemes" });
  });
});

describe("what the experience draws from the form", () => {
  it("keeps airline-only fields only on the airline", () => {
    const v = complete();
    v.flightAirline = "Maya Air";
    expect(experienceFromStudio(v, airline).flight.airline).toBe("Maya Air");
    expect(experienceFromStudio(v, airline).goals![0]!.code).toBe("CPH");
    const other = experienceFromStudio(v, space);
    expect([other.flight.airline, other.goals![0]!.code, other.achievements![0]!.place]).toEqual(["", "", ""]);
  });

  it("a switched-off chapter is null, and a caption without a voice is dropped", () => {
    const v = complete();
    v.goalsEnabled = false;
    v.messageGroups[0]!.people[0]!.voiceCaption = "orphan";
    const data = experienceFromStudio(v, airline);
    expect(data.goals).toBeNull();
    expect(data.messages![0]!.people[0]!.voiceCaption).toBe("");
  });

  it("an unknown journey falls back to the default", () => {
    expect(experienceFromStudio(complete(), { journey: "submarine" }).journey).toBe(DEFAULT_JOURNEY);
  });
});

describe("every word exists in all three languages", () => {
  it.each(["fr", "ar"] as const)("%s has every English key, none left to fall back to English", (locale) => {
    const missing = Object.keys(graduationMessages.en!).filter((k) => !(k in graduationMessages[locale]!));
    expect(missing).toEqual([]);
    expect(Object.keys(graduationMessages[locale]!).filter((k) => !(k in graduationMessages.en!))).toEqual([]);
  });

  it("every label, help and placeholder the form names is translated", () => {
    const keys = new Set<string>();
    for (const [, field] of F) {
      for (const k of [field.label, field.helpText, (field as { placeholder?: string }).placeholder]) if (k) keys.add(k);
      if (field.type === "swatch") field.options.forEach((o) => keys.add(o.label));
    }
    for (const section of graduationSchema.sections) keys.add(section.title);
    for (const locale of ["en", "fr", "ar"] as const) {
      expect([...keys].filter((k) => !(k in graduationMessages[locale]!)), locale).toEqual([]);
    }
  });

  it("every journey has every word, in every language", () => {
    const words = ["start", "path", "then", "now", "next", "ach", "achHint", "achCount", "msg", "msgHint", "goals", "goalTag", "letter", "finale", "welcome"];
    for (const locale of ["en", "fr", "ar"] as const) {
      for (const j of JOURNEY_IDS) for (const w of words) expect(graduationMessages[locale]![`words.${j}.${w}`], `${locale} ${j} ${w}`).toBeTruthy();
    }
  });

  it("is the module the Studio loads", () => {
    expect(graduationKeepsakeModule.renderer).toEqual({ kind: "live" });
    expect(graduationKeepsakeModule.delivery).toEqual({ mode: "hosted", hosted: { description: "delivery.hosted" } });
    expect(graduationKeepsakeModule.pricing.basePriceCents).toBe(1599);
  });
});

describe("on the storefront", () => {
  it("is visible now that its Freemius plan (72194) is mapped", () => {
    expect(getProductBySlug("graduation-keepsake")).toMatchObject({ hidden: false, status: "available", category: "other", icon: "GraduationCap" });
    const entry = getAllProductsIncludingHidden().find((p) => p.slug === "graduation-keepsake");
    expect(entry).toBe(getProductBySlug("graduation-keepsake"));
  });
});
