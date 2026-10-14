import { describe, expect, it } from "vitest";
import type { FormSchemaConfig } from "@/types/studio";
import { formEngine } from "./form-engine";
import { createInitialState } from "./product-modules/reasons-i-love-you/initial-state";
import { reasonsSchema } from "./product-modules/reasons-i-love-you/schema";

/**
 * A FIELD THE CUSTOMER CANNOT SEE CANNOT BLOCK THEM.
 *
 * `GenericForm` hides a field whose `visibleWhen` fails. The engine used to
 * validate it anyway, so a required field behind a switch that was off left
 * the Studio blocked with nothing on screen to fix. (Reasons I Love You worked
 * around this by not marking its letter `required`; see its schema.)
 */
const schema: FormSchemaConfig = {
  sections: [
    {
      id: "s",
      title: "s",
      fields: [
        { id: "name", type: "text", label: "name", required: true, maxLength: 5 },
        { id: "showExtra", type: "boolean", label: "showExtra" },
        { id: "extra", type: "text", label: "extra", required: true, maxLength: 3, visibleWhen: [{ path: "values.showExtra", op: "eq", value: true }] },
        {
          id: "items",
          type: "group",
          label: "items",
          minItems: 1,
          maxItems: 3,
          visibleWhen: [{ path: "values.showExtra", op: "eq", value: true }],
          itemFields: [
            { id: "title", type: "text", label: "title", required: true },
            { id: "code", type: "text", label: "code", required: true, visibleWhen: [{ path: "theme.style", op: "eq", value: "coded" }] },
            { id: "note", type: "text", label: "note", required: true, visibleWhen: [{ path: "values.withNote", op: "eq", value: true }] },
          ],
        },
      ],
    },
  ],
};

describe("formEngine.validate and visibleWhen", () => {
  it("validates a visible required field", () => {
    expect(formEngine.validate(schema, { name: "ok", showExtra: true }, {}).errors.extra).toMatchObject({ code: "required" });
  });

  it("skips a hidden field entirely: required, maxLength, and a hidden group's minItems and items", () => {
    expect(formEngine.validate(schema, { name: "ok", showExtra: false }, {})).toEqual({ valid: true, errors: {} });
    // Stale values left behind in hidden fields do not count either.
    const stale = { name: "ok", showExtra: false, extra: "far too long", items: [{ title: "" }] };
    expect(formEngine.validate(schema, stale, {})).toEqual({ valid: true, errors: {} });
  });

  it("evaluates a group item's visibleWhen against the theme", () => {
    const values = { name: "ok", showExtra: true, extra: "x", items: [{ title: "t" }] };
    expect(formEngine.validate(schema, values, { style: "coded" }).errors["items.0.code"]).toMatchObject({ code: "required" });
    expect(formEngine.validate(schema, values, { style: "plain" }).valid).toBe(true);
  });

  it("evaluates a group item's visibleWhen against that item, not the whole form", () => {
    const values = { name: "ok", showExtra: true, extra: "x", items: [{ title: "t", withNote: true }, { title: "t" }] };
    const errors = formEngine.validate(schema, values, {}).errors;
    expect(Object.keys(errors)).toEqual(["items.0.note"]);
  });

  it("still enforces everything on visible fields", () => {
    const errors = formEngine.validate(schema, { name: "toolong", showExtra: true, extra: "x", items: [] }, {}).errors;
    expect(errors.name).toMatchObject({ code: "maxLength" });
    expect(errors.items).toMatchObject({ code: "minItems" });
  });

  it("treats a missing theme as no selections", () => {
    expect(formEngine.validate(schema, { name: "ok", showExtra: false }).valid).toBe(true);
  });
});

describe("a real schema: Reasons I Love You's letter", () => {
  // The letter's fields carry `visibleWhen: letterEnabled`. Marked required
  // here (they are not in the module, which works around the old engine) to
  // show what the engine now does with a switched-off section.
  const required: FormSchemaConfig = {
    sections: reasonsSchema.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.id === "letterGreeting" ? { ...field, required: true } : field.id === "letterParagraphs" && field.type === "group" ? { ...field, minItems: 1 } : field
      ),
    })),
  };
  const off = { ...createInitialState(), letterEnabled: false, letterGreeting: "", letterParagraphs: [] };

  it("does not block a customer who switched the letter off", () => {
    expect(formEngine.validate(required, off, {})).toEqual({ valid: true, errors: {} });
  });

  it("does require it once the letter is on", () => {
    const errors = formEngine.validate(required, { ...off, letterEnabled: true }, {}).errors;
    expect(errors.letterGreeting).toMatchObject({ code: "required" });
    expect(errors.letterParagraphs).toMatchObject({ code: "minItems" });
  });
});
