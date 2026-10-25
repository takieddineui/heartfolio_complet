import { describe, expect, it } from "vitest";
import { GRADUATION_LIMITS } from "./graduation-keepsake/limits";
import { createInitialState as graduation } from "./graduation-keepsake/initial-state";
import { validateGraduation } from "./graduation-keepsake/validation";
import { createInitialState as timeline } from "./love-story-timeline/initial-state";
import { validateTimeline } from "./love-story-timeline/validation";
import { REASONS_LIMITS } from "./reasons-i-love-you/limits";
import { createInitialState as reasons } from "./reasons-i-love-you/initial-state";
import { validateReasons } from "./reasons-i-love-you/validation";

/**
 * THE STUDIO'S SAMPLE CONTENT SPEAKS THE PAGE'S LANGUAGE (25 Oct 2026).
 * Every Studio opened with English examples on /fr and /ar, and a customer
 * who did not overwrite one shipped English inside a French or Arabic gift.
 * Each language's sample must have the same shape as the English one, share
 * none of its text, and be a valid project the customer could buy as is.
 */
type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json };

function shape(value: Json): Json {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

/** Every string of three or more letters: the text a customer reads. */
function texts(value: Json, found: string[] = []): string[] {
  if (typeof value === "string" && /\p{L}.*\p{L}.*\p{L}/u.test(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => texts(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => texts(item, found));
  return found;
}

/** Names, codes and places that are the same in every language, by design. */
const SHARED = new Set(["Emma", "Maya", "Maya Chen", "Hana", "Kai", "Jonah", "Priya", "Sam", "Cascais", "SCH", "LEG", "ART", "UNI", "CPH", "ARB", "BKE", "TRE", "AAL", "coral", "amber", "mint", "berry", "violet", "couple", "Photo", "Description", "Date", "none", "sky", "Hana,"]);

const PRODUCTS = {
  "love-story-timeline": timeline,
  "reasons-i-love-you": reasons,
  "graduation-keepsake": graduation,
} as const;

describe.each(Object.entries(PRODUCTS))("%s", (_slug, create) => {
  const en = create("en") as unknown as Json;

  it.each(["fr", "ar"])("%s: the same shape as the English sample", (locale) => {
    expect(shape(create(locale) as unknown as Json)).toEqual(shape(en));
  });

  it.each(["fr", "ar"])("%s: none of the English sample's text", (locale) => {
    const english = new Set(texts(en).filter((text) => !SHARED.has(text)));
    const leaked = texts(create(locale) as unknown as Json).filter((text) => english.has(text));
    expect(leaked).toEqual([]);
  });

  it("falls back to English for any other language", () => {
    expect(create("de")).toEqual(create("en"));
    expect(create(undefined)).toEqual(create("en"));
  });
});

describe.each(["en", "fr", "ar"])("%s samples are valid as they open", (locale) => {
  it("Love Story Timeline", () => {
    expect(validateTimeline(timeline(locale)).errors).toEqual({});
  });

  it("Reasons I Love You, within its limits", () => {
    const sample = reasons(locale);
    expect(validateReasons(sample).errors).toEqual({});
    for (const reason of sample.reasons) {
      expect(reason.text.length).toBeLessThanOrEqual(REASONS_LIMITS.reasonMaxLength);
      expect((reason.memory ?? "").length).toBeLessThanOrEqual(REASONS_LIMITS.memoryMaxLength);
    }
    expect(sample.finaleLine.length).toBeLessThanOrEqual(REASONS_LIMITS.finaleLineMaxLength);
    expect(sample.letterGreeting.length).toBeLessThanOrEqual(REASONS_LIMITS.greetingMaxLength);
    expect(sample.letterSignoff.length).toBeLessThanOrEqual(REASONS_LIMITS.signoffMaxLength);
  });

  it("Graduation Keepsake, within its limits", () => {
    const sample = graduation(locale);
    const L = GRADUATION_LIMITS;
    expect(validateGraduation(sample).errors).toEqual({});
    expect(sample.gradName.length).toBeLessThanOrEqual(L.nameMaxLength);
    expect(sample.gradFullName.length).toBeLessThanOrEqual(L.fullNameMaxLength);
    expect(sample.gradDegree.length).toBeLessThanOrEqual(L.degreeMaxLength);
    expect(sample.gradSchool.length).toBeLessThanOrEqual(L.schoolMaxLength);
    for (const text of [sample.thenText, sample.nowText, sample.nextText]) expect(text.length).toBeLessThanOrEqual(L.pathTextMaxLength);
    for (const stop of sample.stops) expect(stop.caption.length).toBeLessThanOrEqual(L.stopCaptionMaxLength);
    for (const a of sample.achievements) {
      expect(a.title.length, a.title).toBeLessThanOrEqual(L.achievementTitleMaxLength);
      expect((a.detail ?? "").length, a.detail).toBeLessThanOrEqual(L.achievementDetailMaxLength);
      expect((a.place ?? "").length, a.place).toBeLessThanOrEqual(L.achievementPlaceMaxLength);
    }
    for (const group of sample.messageGroups) {
      expect(group.label.length).toBeLessThanOrEqual(L.groupLabelMaxLength);
      for (const person of group.people) {
        expect(person.name.length).toBeLessThanOrEqual(L.personNameMaxLength);
        expect(person.message.length).toBeLessThanOrEqual(L.messageMaxLength);
      }
    }
    for (const goal of sample.goals) expect(goal.text.length, goal.text).toBeLessThanOrEqual(L.goalMaxLength);
    for (const p of sample.letterParagraphs) expect(p.text.length).toBeLessThanOrEqual(L.paragraphMaxLength);
    expect(sample.letterGreeting.length).toBeLessThanOrEqual(L.greetingMaxLength);
    expect(sample.letterSignoff.length).toBeLessThanOrEqual(L.signoffMaxLength);
    expect(sample.endingLine.length).toBeLessThanOrEqual(L.endingLineMaxLength);
  });
});
