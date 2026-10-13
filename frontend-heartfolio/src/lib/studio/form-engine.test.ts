import { describe, expect, it } from "vitest";
import type { FormSchemaConfig } from "@/types/studio";
import { createGroupItemDefaults, formEngine } from "./form-engine";

/**
 * A field the customer cannot see cannot block them. `GenericForm` hides a
 * field whose `visibleWhen` fails; before this, the engine validated it anyway,
 * so a switched-off chapter's required fields left Continue disabled with
 * nothing on screen to fix.
 */

const schema: FormSchemaConfig = {
  sections: [
    {
      id: "s",
      title: "s",
      fields: [
        { id: "name", type: "text", label: "name", required: true, maxLength: 5 },
        { id: "showExtra", type: "boolean", label: "showExtra" },
        {
          id: "extra",
          type: "text",
          label: "extra",
          required: true,
          visibleWhen: [{ path: "values.showExtra", op: "eq", value: true }],
        },
        {
          id: "items",
          type: "group",
          label: "items",
          minItems: 1,
          maxItems: 3,
          visibleWhen: [{ path: "values.showExtra", op: "eq", value: true }],
          itemFields: [
            { id: "title", type: "text", label: "title", required: true },
            { id: "code", type: "text", label: "code", required: true, visibleWhen: [{ path: "theme.journey", op: "eq", value: "airline" }] },
            {
              id: "people",
              type: "group",
              label: "people",
              minItems: 1,
              maxItems: 2,
              itemFields: [{ id: "who", type: "text", label: "who", required: true }],
            },
          ],
        },
      ],
    },
  ],
};

describe("formEngine.validate", () => {
  it("validates a visible required field", () => {
    expect(formEngine.validate(schema, { showExtra: true }, {}).errors.extra).toMatchObject({ code: "required" });
  });

  it("skips a field whose visibleWhen fails, including a whole hidden group", () => {
    const result = formEngine.validate(schema, { name: "ok", showExtra: false }, {});
    expect(result.valid).toBe(true);
  });

  it("evaluates a group item's visibleWhen against the item and the theme", () => {
    const values = { name: "ok", showExtra: true, extra: "x", items: [{ title: "t", people: [{ who: "w" }] }] };
    expect(formEngine.validate(schema, values, { journey: "airline" }).errors["items.0.code"]).toMatchObject({ code: "required" });
    expect(formEngine.validate(schema, values, { journey: "other" }).valid).toBe(true);
  });

  it("reports a nested group's items with their full path", () => {
    const values = { name: "ok", showExtra: true, extra: "x", items: [{ title: "t", people: [{ who: "w" }, { who: "" }] }] };
    const errors = formEngine.validate(schema, values, { journey: "other" }).errors;
    expect(Object.keys(errors)).toEqual(["items.0.people.1.who"]);
  });

  it("still enforces group minItems and maxLength", () => {
    const errors = formEngine.validate(schema, { name: "toolong", showExtra: true, extra: "x", items: [] }, {}).errors;
    expect(errors.name).toMatchObject({ code: "maxLength" });
    expect(errors.items).toMatchObject({ code: "minItems" });
  });

  it("behaves as before for callers that pass no theme", () => {
    expect(formEngine.validate(schema, { name: "ok", showExtra: false }).valid).toBe(true);
  });
});

describe("createGroupItemDefaults", () => {
  it("seeds a nested group's default so a new item is not born invalid", () => {
    const defaults = createGroupItemDefaults([
      { id: "label", type: "text", label: "l" },
      { id: "people", type: "group", label: "p", minItems: 1, maxItems: 2, defaultValue: [{ who: "" }], itemFields: [] },
    ]);
    expect(defaults).toEqual({ people: [{ who: "" }] });
  });
});
