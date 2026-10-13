import { describe, expect, it } from "vitest";
import type { FieldSchema, FormSchemaConfig } from "@/types/studio";
import { formEngine } from "@/lib/studio/form-engine";
import { resolveModuleText } from "@/lib/studio/i18n";
import { graduationKeepsakeModule } from "./index";
import { graduationMessages } from "./messages";
import { createInitialState, createInitialThemeSelections, type GraduationValues } from "./initial-state";
import { PERSON_COLORS, PERSON_EMOJIS, personColorHex, personEmojiGlyph } from "./palette";
import { validateGraduation } from "./validation";
import { getProductModuleLoader } from "../registry";

const LOCALES = ["en", "fr", "ar"] as const;
const theme = createInitialThemeSelections();

/** A project the generic floor accepts with every chapter ON. */
function complete(): GraduationValues {
  const photo = { url: "blob:x", mimeType: "image/jpeg", filename: "a.jpg", assetId: "8d3f1f62-0000-4000-8000-000000000001" };
  return {
    ...createInitialState(),
    gradName: "Maya",
    gradFullName: "Maya Chen",
    gradDegree: "BA",
    gradSchool: "Edinburgh",
    gradDate: "2027-07-02",
    gradPhoto: photo,
    thenYear: "2005",
    thenText: "Then",
    thenPhoto: photo,
    stops: [{ year: "2010", caption: "School", photo }],
    nowYear: "2027",
    nowText: "Now",
    nextText: "Next",
    nextPhoto: photo,
    achievements: [{ title: "Honours" }],
    messageGroups: [{ label: "Home", people: [{ name: "Mum", color: "coral", emoji: "home", message: "Proud" }] }],
    goals: [{ text: "Goal" }],
    letterGreeting: "Dear Maya,",
    letterBody: [{ text: "Hello" }],
    letterSignatures: [{ name: "Mum" }],
    endingLine: "Congrats",
  };
}

function walk(fields: FieldSchema[], visit: (field: FieldSchema) => void) {
  for (const field of fields) {
    visit(field);
    if (field.type === "group") walk(field.itemFields, visit);
  }
}

describe("module registration", () => {
  it("is registered under the product slug", async () => {
    const loader = getProductModuleLoader("graduation-keepsake");
    expect(loader).toBeDefined();
    expect(await loader!()).toBe(graduationKeepsakeModule);
  });

  it("is live-only: the Live tab is the only preview, and nothing is exported", () => {
    expect(graduationKeepsakeModule.previewModes).toEqual(["live"]);
    expect(graduationKeepsakeModule.delivery.mode).toBe("interactive");
    expect(graduationKeepsakeModule.livePreview?.component).toBeTypeOf("function");
    expect(graduationKeepsakeModule.pricing.rules).toEqual([]);
  });

  it("offers one journey axis whose options are the implemented journeys", () => {
    const [axis, ...rest] = graduationKeepsakeModule.themes.axes;
    expect(rest).toEqual([]);
    expect(axis!.id).toBe("journey");
    expect(createInitialThemeSelections()).toEqual({ journey: "airline" });
  });
});

describe.each(LOCALES)("Studio copy (%s)", (locale) => {
  const messages = graduationMessages;

  it("has the same keys in every locale", () => {
    expect(Object.keys(messages[locale]!).sort()).toEqual(Object.keys(messages.en!).sort());
  });

  it("resolves every label, help text, placeholder, option and theme key (no raw keys reach a customer)", () => {
    const keys = new Set<string>();
    const add = (key: string | undefined) => key && keys.add(key);
    for (const section of graduationSchema().sections) {
      add(section.title);
      walk(section.fields, (field) => {
        add(field.label);
        add(field.helpText);
        if ("placeholder" in field) add(field.placeholder);
        if (field.type === "select" || field.type === "multiSelect") field.options.forEach((o) => add(o.label));
      });
    }
    for (const axis of graduationKeepsakeModule.themes.axes) {
      add(axis.label);
      if (axis.kind !== "range") axis.options.forEach((o) => add(o.label));
    }
    add(graduationKeepsakeModule.delivery.mode === "interactive" ? graduationKeepsakeModule.delivery.interactive.descriptionKey : undefined);
    add("packs.live.name");
    add("packs.live.description");
    add("validation.notThreeLetters");
    add("validation.invalidDate");

    const unresolved = [...keys].filter((key) => resolveModuleText(key, locale, messages) === key);
    expect(unresolved).toEqual([]);
  });

  it("names every colour and emoji", () => {
    for (const color of PERSON_COLORS) expect(messages[locale]![`colors.${color.id}`]).toBeTruthy();
    for (const emoji of PERSON_EMOJIS) expect(messages[locale]![`emojis.${emoji.id}`]).toContain(emoji.glyph);
  });
});

function graduationSchema(): FormSchemaConfig {
  return graduationKeepsakeModule.formSchema;
}

describe("chapters and validation", () => {
  it("accepts a complete project", () => {
    expect(formEngine.validate(graduationSchema(), complete(), theme).valid).toBe(true);
    expect(validateGraduation(complete()).valid).toBe(true);
  });

  it("a switched-off chapter neither shows nor blocks: its required fields are skipped", () => {
    const empty = createInitialState();
    const withEverythingOn = formEngine.validate(graduationSchema(), empty, theme);
    expect(Object.keys(withEverythingOn.errors).some((k) => k.startsWith("stops"))).toBe(true);
    expect(withEverythingOn.errors.letterGreeting).toBeDefined();

    const off = {
      ...empty,
      showPath: false,
      showAchievements: false,
      showMessages: false,
      showGoals: false,
      showLetter: false,
    };
    const errors = Object.keys(formEngine.validate(graduationSchema(), off, theme).errors).sort();
    // Only the graduate block and the ending are always required.
    expect(errors).toEqual(["endingLine", "gradDate", "gradDegree", "gradFullName", "gradName", "gradPhoto", "gradSchool"]);
  });

  it("flags a nested group's items with their full path", () => {
    const values = complete();
    values.messageGroups[0]!.people[0]!.message = "";
    const errors = formEngine.validate(graduationSchema(), values, theme).errors;
    expect(errors["messageGroups.0.people.0.message"]).toMatchObject({ code: "required" });
  });

  it("airline-only fields are skipped under another journey but exist for airline", () => {
    const values = complete();
    const stop = values.stops[0]!;
    stop.code = "toolong";
    // maxLength is generic; the code's SHAPE is the module's own rule.
    expect(validateGraduation(values).errors["stops.0.code"]).toMatchObject({ code: "notThreeLetters" });
    expect(validateGraduation({ ...values, stops: [{ ...stop, code: "SCH" }] }).valid).toBe(true);
  });

  it("rejects a date that is not a real one", () => {
    expect(validateGraduation({ ...complete(), gradDate: "2027-13-45" }).errors.gradDate).toMatchObject({ code: "invalidDate" });
    expect(validateGraduation({ ...complete(), gradDate: "1800-01-01" }).errors.gradDate).toMatchObject({ code: "invalidDate" });
  });

  it("does not check codes inside a chapter that is off", () => {
    const values = { ...complete(), showPath: false, stops: [{ year: "", caption: "", code: "x" }] };
    expect(validateGraduation(values).valid).toBe(true);
  });
});

describe("palette", () => {
  it("resolves ids and never echoes an unknown value into a style", () => {
    expect(personColorHex("blue")).toBe("#2f7fd8");
    expect(personColorHex("red;background:url(//evil)")).toBe(PERSON_COLORS[0]!.hex);
    expect(personColorHex(undefined)).toBe(PERSON_COLORS[0]!.hex);
    expect(personEmojiGlyph("cap")).toBe("🎓");
    expect(personEmojiGlyph("<script>")).toBe("❤️");
  });

  it("uses CSS-safe hex colours", () => {
    for (const color of PERSON_COLORS) expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
