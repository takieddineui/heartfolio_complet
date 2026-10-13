import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendRoot } from "../../../../../test/backend-root";
import { DEFAULT_JOURNEY, JOURNEYS } from "./journeys";
import { LIMITS } from "./limits";
import { PERSON_COLORS, PERSON_EMOJIS } from "./palette";
import { graduationSchema } from "./schema";

/**
 * The backend's `data.py` is authoritative for what a graduation project may
 * contain; the Studio mirrors it. Nothing connects the two automatically, so
 * these read the Python file and fail when a list or a number drifts - the same
 * arrangement `composition-parity.test.ts` has with the Pillow renderers. Like
 * that test, `backendRoot()` THROWS rather than skips when the backend is not
 * found: a skipped parity test reports drift as green.
 */

const source = readFileSync(
  join(backendRoot(), "apps", "delivery", "product_renderers", "graduation_keepsake", "data.py"),
  "utf8"
);

/** `NAME = ("a", "b", ...)` -> ["a", "b", ...] */
function tuple(name: string): string[] {
  const match = source.match(new RegExp(`^${name} = \\(([\\s\\S]*?)\\)\\n`, "m"));
  if (!match) throw new Error(`data.py has no tuple named ${name}`);
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

function constant(name: string): number {
  const match = source.match(new RegExp(`^${name} = (\\d+)$`, "m"));
  if (!match) throw new Error(`data.py has no integer constant ${name}`);
  return Number(match[1]);
}

function range(minName: string, maxName: string): { min: number; max: number } {
  const match = source.match(new RegExp(`^${minName}, ${maxName} = (\\d+), (\\d+)$`, "m"));
  if (!match) throw new Error(`data.py has no range ${minName}, ${maxName}`);
  return { min: Number(match[1]), max: Number(match[2]) };
}

describe("backend parity", () => {
  it("offers exactly the journeys the backend accepts", () => {
    expect(JOURNEYS.map((j) => j.id)).toEqual(tuple("JOURNEYS"));
    expect(DEFAULT_JOURNEY).toBe(source.match(/^DEFAULT_JOURNEY = "(\w+)"/m)![1]);
  });

  it("uses the backend's colour and emoji ids, in the same order", () => {
    expect(PERSON_COLORS.map((c) => c.id)).toEqual(tuple("PERSON_COLORS"));
    expect(PERSON_EMOJIS.map((e) => e.id)).toEqual(tuple("PERSON_EMOJIS"));
  });

  it("uses the backend's text ceilings", () => {
    const pairs: [keyof typeof LIMITS, string][] = [
      ["name", "NAME_MAX"],
      ["fullName", "FULL_NAME_MAX"],
      ["degree", "DEGREE_MAX"],
      ["school", "SCHOOL_MAX"],
      ["yearText", "YEAR_TEXT_MAX"],
      ["storyText", "STORY_TEXT_MAX"],
      ["caption", "CAPTION_MAX"],
      ["achievementTitle", "ACHIEVEMENT_TITLE_MAX"],
      ["achievementDetail", "ACHIEVEMENT_DETAIL_MAX"],
      ["achievementPlace", "ACHIEVEMENT_PLACE_MAX"],
      ["groupLabel", "GROUP_LABEL_MAX"],
      ["message", "MESSAGE_MAX"],
      ["goal", "GOAL_MAX"],
      ["greeting", "GREETING_MAX"],
      ["paragraph", "PARAGRAPH_MAX"],
      ["signoff", "SIGNOFF_MAX"],
      ["signature", "SIGNATURE_MAX"],
      ["endingLine", "ENDING_LINE_MAX"],
      ["endingSub", "ENDING_SUB_MAX"],
      ["flightField", "FLIGHT_FIELD_MAX"],
      ["flightNumber", "FLIGHT_NUMBER_MAX"],
      ["flightSeat", "FLIGHT_SEAT_MAX"],
      ["flightPlace", "FLIGHT_PLACE_MAX"],
    ];
    for (const [key, name] of pairs) expect(LIMITS[key], `${key} vs ${name}`).toBe(constant(name));
  });

  it("uses the backend's item-count ranges", () => {
    expect(LIMITS.stops).toEqual(range("MIN_STOPS", "MAX_STOPS"));
    expect(LIMITS.achievements).toEqual(range("MIN_ACHIEVEMENTS", "MAX_ACHIEVEMENTS"));
    expect(LIMITS.messageGroups).toEqual(range("MIN_MESSAGE_GROUPS", "MAX_MESSAGE_GROUPS"));
    expect(LIMITS.people).toEqual(range("MIN_PEOPLE", "MAX_PEOPLE"));
    expect(LIMITS.goals).toEqual(range("MIN_GOALS", "MAX_GOALS"));
    expect(LIMITS.letterBody).toEqual(range("MIN_LETTER_PARAGRAPHS", "MAX_LETTER_PARAGRAPHS"));
    expect(LIMITS.signatures).toEqual(range("MIN_SIGNATURES", "MAX_SIGNATURES"));
  });

  it("matches the backend's audio ceiling (60 seconds) in the field and the setting", () => {
    const media = readFileSync(join(backendRoot(), "apps", "assets", "media.py"), "utf8");
    expect(Number(media.match(/^MAX_AUDIO_SECONDS = (\d+)$/m)![1])).toBe(LIMITS.voiceSeconds);
  });

  it("asks for every top-level key the backend reads, and nothing it ignores", () => {
    // Every key the backend validator reads from `values`...
    const read = new Set<string>();
    for (const m of source.matchAll(/(?:_text|_required_media|_optional_media|_code|_choice|_flag|_items)\(\s*(?:values|raw|raw_group|source),\s*"(\w+)"/g)) {
      read.add(m[1]!);
    }
    for (const m of source.matchAll(/\bvalues\.get\("(\w+)"\)/g)) read.add(m[1]!);
    const flags = [...source.matchAll(/\("(\w+)", "(show\w+)"\)/g)].map((m) => m[2]!);
    flags.forEach((flag) => read.add(flag));

    // ...against the top-level field ids the Studio form writes.
    const written = new Set(graduationSchema.sections.flatMap((s) => s.fields.map((f) => f.id)));
    written.add("language");

    // Item-level keys are read through the same helpers; keep only top-level.
    const nested = new Set(["year", "caption", "photo", "code", "title", "detail", "place", "label", "people", "name",
      "color", "emoji", "message", "voice", "drawing", "text"]);
    const topLevelRead = [...read].filter((key) => !nested.has(key));

    expect([...written].filter((key) => !topLevelRead.includes(key))).toEqual([]);
    expect(topLevelRead.filter((key) => !written.has(key))).toEqual([]);
  });
});
