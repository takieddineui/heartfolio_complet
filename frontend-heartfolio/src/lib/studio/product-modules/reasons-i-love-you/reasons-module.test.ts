import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { experienceFromStudio, resolveTitle } from "@/components/live-reasons/experience-data";
import type { FieldSchema, GroupFieldSchema } from "@/types/studio";
import { productModuleRegistry } from "../registry";
import { GIFT_IDS, GIFTS, DEFAULT_GIFT, giftOrDefault } from "./gifts";
import { reasonsILoveYouModule } from "./index";
import { createInitialState, createInitialThemeSelections } from "./initial-state";
import { REASONS_LIMITS } from "./limits";
import { reasonsMessages } from "./messages";
import { reasonsSchema } from "./schema";
import { validateReasons } from "./validation";

/**
 * REASONS I LOVE YOU, the Studio side.
 *
 * The caps and the four gift ids are pinned against the backend's `data.py`,
 * read from disk. Same rule as `composition-parity.test.ts`: THROWS if the
 * backend cannot be found, rather than skipping, because a skipped parity
 * test reports drift as green.
 */
function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "apps", "delivery", "product_renderers"))) return candidate;
  }
  throw new Error(`Cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH. Tried: ${candidates.join(" | ")}`);
}

const DATA_PY = readFileSync(join(backendRoot(), "apps", "delivery", "product_renderers", "reasons_i_love_you", "data.py"), "utf8");

function pythonConstant(name: string): string {
  const match = DATA_PY.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  if (!match) throw new Error(`data.py has no ${name}`);
  return match[1]!.trim();
}

const PYTHON_NAMES: Record<keyof typeof REASONS_LIMITS, string> = {
  minReasons: "MIN_REASONS",
  maxReasons: "MAX_REASONS",
  minParagraphs: "MIN_PARAGRAPHS",
  maxParagraphs: "MAX_PARAGRAPHS",
  nameMaxLength: "NAME_MAX_LENGTH",
  titleMaxLength: "TITLE_MAX_LENGTH",
  reasonMaxLength: "REASON_MAX_LENGTH",
  memoryMaxLength: "MEMORY_MAX_LENGTH",
  teaserMaxLength: "TEASER_MAX_LENGTH",
  finaleLineMaxLength: "FINALE_LINE_MAX_LENGTH",
  signatureMaxLength: "SIGNATURE_MAX_LENGTH",
  greetingMaxLength: "GREETING_MAX_LENGTH",
  paragraphMaxLength: "PARAGRAPH_MAX_LENGTH",
  signoffMaxLength: "SIGNOFF_MAX_LENGTH",
};

function allFields(fields: FieldSchema[]): FieldSchema[] {
  return fields.flatMap((field) => (field.type === "group" ? [field, ...allFields(field.itemFields)] : [field]));
}
const FIELDS = reasonsSchema.sections.flatMap((section) => allFields(section.fields));
const field = (id: string) => {
  const found = FIELDS.find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
};
const maxLengthOf = (id: string) => (field(id) as { maxLength?: number }).maxLength;
const reasonsGroup = field("reasons") as GroupFieldSchema;
const reasonItem = (id: string) => reasonsGroup.itemFields.find((f) => f.id === id) as { maxLength?: number; required?: boolean };

describe("limits and gifts agree with the backend", () => {
  it.each(Object.entries(PYTHON_NAMES))("%s matches data.py's %s", (key, pythonName) => {
    expect(Number(pythonConstant(pythonName))).toBe(REASONS_LIMITS[key as keyof typeof REASONS_LIMITS]);
  });

  it("has the same four gifts and the same default", () => {
    expect(pythonConstant("GIFTS")).toBe(`(${GIFT_IDS.map((id) => `"${id}"`).join(", ")})`);
    expect(pythonConstant("DEFAULT_GIFT")).toBe(`"${DEFAULT_GIFT}"`);
  });

  it("caps the reasons at ten, the deck's Ace to 10 of Hearts", () => {
    expect(REASONS_LIMITS.maxReasons).toBe(10);
  });
});

describe("the form uses those limits", () => {
  it("caps every text field at its named limit", () => {
    expect(maxLengthOf("toName")).toBe(REASONS_LIMITS.nameMaxLength);
    expect(maxLengthOf("fromName")).toBe(REASONS_LIMITS.nameMaxLength);
    expect(maxLengthOf("title")).toBe(REASONS_LIMITS.titleMaxLength);
    expect(reasonItem("text").maxLength).toBe(REASONS_LIMITS.reasonMaxLength);
    expect(reasonItem("memory").maxLength).toBe(REASONS_LIMITS.memoryMaxLength);
    expect(maxLengthOf("finaleTeaser")).toBe(REASONS_LIMITS.teaserMaxLength);
    expect(maxLengthOf("finaleLine")).toBe(REASONS_LIMITS.finaleLineMaxLength);
    expect(maxLengthOf("signature")).toBe(REASONS_LIMITS.signatureMaxLength);
    expect(maxLengthOf("letterGreeting")).toBe(REASONS_LIMITS.greetingMaxLength);
    expect(maxLengthOf("letterSignoff")).toBe(REASONS_LIMITS.signoffMaxLength);
    const paragraphs = field("letterParagraphs") as GroupFieldSchema;
    expect((paragraphs.itemFields[0] as { maxLength?: number }).maxLength).toBe(REASONS_LIMITS.paragraphMaxLength);
  });

  it("allows one to ten reasons, each needing words and optionally a photo and a memory", () => {
    expect(reasonsGroup.minItems).toBe(REASONS_LIMITS.minReasons);
    expect(reasonsGroup.maxItems).toBe(REASONS_LIMITS.maxReasons);
    expect(reasonItem("text").required).toBe(true);
    expect(reasonsGroup.itemFields.find((f) => f.id === "photo")?.type).toBe("image");
    expect(reasonItem("photo").required).toBeFalsy();
    expect(reasonItem("memory").required).toBeFalsy();
  });

  it("does not mark the letter's fields required (the shared validator ignores visibleWhen)", () => {
    expect((field("letterGreeting") as { required?: boolean }).required).toBeFalsy();
    expect((field("letterParagraphs") as GroupFieldSchema).minItems).toBe(0);
    expect((field("letterParagraphs") as GroupFieldSchema).maxItems).toBe(REASONS_LIMITS.maxParagraphs);
    for (const id of ["letterGreeting", "letterParagraphs", "letterSignoff"]) {
      expect(field(id).visibleWhen).toEqual([{ path: "values.letterEnabled", op: "eq", value: true }]);
    }
  });

  it("has nothing that v1 deliberately leaves out", () => {
    const ids = FIELDS.map((f) => f.id);
    for (const absent of ["reply", "replyPrompt", "quick", "musicSrc", "song", "branding", "showBranding", "sendAt", "meta"]) {
      expect(ids).not.toContain(absent);
    }
  });
});

describe("the letter is required only while it is on", () => {
  it("accepts the Studio's opening state", () => {
    expect(validateReasons(createInitialState())).toEqual({ valid: true, errors: {} });
  });

  it("asks for a greeting and a paragraph while on, and nothing while off", () => {
    const on = { ...createInitialState(), letterGreeting: " ", letterParagraphs: [] };
    expect(validateReasons(on).errors).toEqual({
      letterGreeting: { code: "letterGreetingRequired" },
      letterParagraphs: { code: "letterParagraphsRequired" },
    });
    expect(validateReasons({ ...on, letterEnabled: false })).toEqual({ valid: true, errors: {} });
    const blank = { ...createInitialState(), letterParagraphs: [{ text: "ok" }, { text: "  " }] };
    expect(validateReasons(blank).errors).toEqual({ "letterParagraphs.1.text": { code: "letterParagraphEmpty" } });
  });
});

describe("the module", () => {
  it("is registered, live-only, and hosted", async () => {
    expect(await productModuleRegistry["reasons-i-love-you"]!()).toBe(reasonsILoveYouModule);
    expect(reasonsILoveYouModule.renderer).toEqual({ kind: "live" });
    expect(reasonsILoveYouModule.delivery).toEqual({ mode: "hosted", hosted: { description: "delivery.hosted" } });
    expect(reasonsILoveYouModule.livePreview).toBeDefined();
  });

  it("offers the four gifts, the jar first and by default", () => {
    const axis = reasonsILoveYouModule.themes.axes[0]!;
    expect(axis.id).toBe("gift");
    expect("options" in axis && axis.options.map((o) => o.id)).toEqual(["jar", "daisy", "deck", "cookies"]);
    expect(createInitialThemeSelections()).toEqual({ gift: "jar" });
    expect(giftOrDefault("tiara")).toBe("jar");
  });

  it("keeps each gift's prototype instrument", () => {
    expect(Object.values(GIFTS).map((g) => [g.id, g.instrument, g.bpm])).toEqual([
      ["jar", "kalimba", 84],
      ["daisy", "ukulele", 100],
      ["deck", "vibraphone", 66],
      ["cookies", "chimes", 56],
    ]);
  });
});

describe("the copy exists in all three languages", () => {
  const used = new Set<string>();
  for (const f of FIELDS) {
    used.add(f.label);
    if ("helpText" in f && f.helpText) used.add(f.helpText);
    if ("placeholder" in f && f.placeholder) used.add(f.placeholder);
  }
  for (const section of reasonsSchema.sections) used.add(section.title);
  for (const axis of reasonsILoveYouModule.themes.axes) {
    used.add(axis.label);
    if ("options" in axis) axis.options.forEach((o) => used.add(o.label));
  }
  for (const id of GIFT_IDS) ["tap", "finaleHint"].forEach((k) => used.add(`gifts.${id}.${k}`));
  for (const key of Object.keys(reasonsMessages.en!)) if (key.startsWith("experience.") || key.startsWith("validation.") || key.startsWith("packs.")) used.add(key);
  used.add("delivery.hosted");

  it.each(["en", "fr", "ar"] as const)("%s has its OWN entry for every key the product uses", (locale) => {
    const own = reasonsMessages[locale]!;
    const missing = [...used].filter((key) => !own[key] && !(locale !== "en" && key === "experience.title.one" && own["experience.title.one"]));
    // French and Arabic choose their own plural categories (see below), so the
    // English title keys are checked there, not here.
    expect(missing.filter((key) => !key.startsWith("experience.title."))).toEqual([]);
  });

  it("never leaves an English sentence standing in for French or Arabic", () => {
    for (const locale of ["fr", "ar"] as const) {
      for (const [key, text] of Object.entries(reasonsMessages[locale]!)) {
        if (["sections.options", "packs.live.name"].includes(key) && locale === "fr") continue; // "Options" is French too
        expect(text, `${locale} ${key}`).not.toBe(reasonsMessages.en![key]);
      }
    }
  });
});

describe("the default title follows each language's plural rules", () => {
  const titled = (count: number, locale: string, title = "") =>
    resolveTitle({ title, reasons: Array.from({ length: count }, () => ({ text: "x", memory: "", photo: null })) }, locale);

  it("English: one, then many", () => {
    expect(titled(1, "en")).toBe("1 reason I love you");
    expect(titled(10, "en")).toBe("10 reasons I love you");
  });

  it("French: 1 is singular, 2 and up plural", () => {
    expect(titled(1, "fr")).toBe("1 raison pour laquelle je t'aime");
    expect(titled(2, "fr")).toBe("2 raisons pour lesquelles je t'aime");
  });

  it("Arabic: its own forms for 1, 2 and 3-10, in Arabic digits, never English", () => {
    expect(titled(1, "ar")).toBe("سبب واحد يجعلني أحبك");
    expect(titled(2, "ar")).toBe("سببان يجعلانني أحبك");
    expect(titled(3, "ar")).toBe("٣ أسباب تجعلني أحبك");
    expect(titled(10, "ar")).toBe("١٠ أسباب تجعلني أحبك");
  });

  it("a title the sender wrote is kept, with {count} filled in", () => {
    expect(titled(5, "en", "{count} things about Hana")).toBe("5 things about Hana");
    expect(titled(5, "ar", "{count} أشياء")).toBe("٥ أشياء");
    expect(titled(5, "en", "No number here")).toBe("No number here");
  });
});

describe("from the Studio's form to the experience", () => {
  it("drops reasons with no words, caps at ten, and maps photos and the letter", () => {
    const values = {
      ...createInitialState(),
      reasons: [
        { text: "  " },
        { text: "With a photo", photo: { url: "blob:preview", assetId: "a1" }, memory: " m " },
        ...Array.from({ length: 12 }, (_, i) => ({ text: `r${i}` })),
      ],
    };
    const data = experienceFromStudio(values, { gift: "cookies" });
    expect(data.gift).toBe("cookies");
    expect(data.reasons).toHaveLength(10);
    expect(data.reasons[0]).toEqual({ text: "With a photo", memory: "m", photo: { url: "blob:preview" } });
    expect(data.letter?.paragraphs).toHaveLength(2);
    expect(experienceFromStudio({ ...values, letterEnabled: false }, {}).letter).toBeNull();
    expect(experienceFromStudio(values, { gift: "nope" }).gift).toBe("jar");
  });
});
