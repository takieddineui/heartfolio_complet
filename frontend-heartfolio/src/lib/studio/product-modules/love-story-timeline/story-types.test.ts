import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORY_TYPE,
  MAX_PEOPLE,
  MIN_PEOPLE,
  STORY_TYPES,
  defaultTitleKey,
  durationKey,
  getStoryType,
  proposeTitleKey,
} from "./story-types";
import { timelineMessages } from "./messages";
import { timelineSchema } from "./schema";

/**
 * §16 / §17 — story types, and the title Heartfolio proposes.
 *
 * The load-bearing test is the one about NOT overwriting. §17 says
 * generated content must never overpower the customer's own words, and
 * their title is their words — silently replacing it when they change story
 * type would be the single most annoying thing this feature could do.
 */
// Named export, not a default — the module exports `timelineMessages`.
const resolve = (key: string) => timelineMessages.en?.[key] ?? key;

describe("story types", () => {
  it("defines all four contexts from §16", () => {
    expect(STORY_TYPES.map((t) => t.id)).toEqual(["couple", "family", "parents", "gift"]);
  });

  it("falls back to a real type for an unknown id", () => {
    // Saved projects are opaque JSON; a stale or hand-edited value must not
    // produce an undefined type deep in the renderer.
    expect(getStoryType("nonsense").id).toBe(DEFAULT_STORY_TYPE);
    expect(getStoryType(undefined).id).toBe(DEFAULT_STORY_TYPE);
  });

  it("only offers a duration line where it means something", () => {
    // "days together" on a family history reads as a bug.
    expect(durationKey("couple")).toBeTruthy();
    expect(durationKey("parents")).toBeTruthy();
    expect(durationKey("family")).toBeNull();
    expect(durationKey("gift")).toBeNull();
  });

  it("gives every type a translated default title", () => {
    for (const type of STORY_TYPES) {
      const key = defaultTitleKey(type.id);
      expect(resolve(key), `${type.id} has no default title`).not.toBe(key);
    }
  });
});

describe("names in the story", () => {
  it("allows one or two names, for every story type", () => {
    expect([MIN_PEOPLE, MAX_PEOPLE]).toEqual([1, 2]);
    const people = timelineSchema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "people");
    expect(people).toMatchObject({ type: "group", minItems: 1, maxItems: 2 });
  });

  it("carries no per-type name bounds that nothing enforces", () => {
    for (const type of STORY_TYPES) {
      expect(type).not.toHaveProperty("minPeople");
      expect(type).not.toHaveProperty("maxPeople");
    }
  });
});

describe("proposed titles (§17)", () => {
  it("fills an empty title", () => {
    expect(proposeTitleKey("", "family", resolve)).toBe(defaultTitleKey("family"));
  });

  it("replaces a title Heartfolio itself proposed", () => {
    // Switching couple → family should move "Our Love Story" on to "Our
    // Family Story" rather than leaving a mismatched one behind.
    const previous = resolve(defaultTitleKey("couple"));
    expect(proposeTitleKey(previous, "family", resolve)).toBe(defaultTitleKey("family"));
  });

  it("NEVER replaces a title the customer wrote", () => {
    // The one that matters. Their title is their words.
    expect(proposeTitleKey("The Long Way Round", "family", resolve)).toBeNull();
  });

  it("recognises a proposed title regardless of surrounding whitespace", () => {
    const previous = `  ${resolve(defaultTitleKey("couple"))}  `;
    expect(proposeTitleKey(previous, "gift", resolve)).toBe(defaultTitleKey("gift"));
  });

  it("does not need a was-generated flag to work", () => {
    /**
     * Recognition is by comparison against every type's default, not by
     * tracked state. A flag would live in the saved project, and it would
     * be wrong the first time someone reloaded an older draft or the
     * defaults were reworded.
     */
    const source = proposeTitleKey.toString();
    expect(source).toContain("STORY_TYPES.some");
  });
});
