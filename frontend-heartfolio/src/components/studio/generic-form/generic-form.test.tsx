import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormSchemaConfig } from "@/types/studio";

const moduleMessages = vi.hoisted(() => ({ en: { "help.count": "{used} of 5 used in this keepsake." } as Record<string, string> }));
vi.mock("@/lib/studio/product-state-context", () => ({
  useProductState: () => ({ session: { module: { messages: moduleMessages } }, locale: "en", t: (key: string) => key }),
}));

import { GenericForm } from "./generic-form";

/**
 * EVERY ROW'S LABEL IS ASSOCIATED WITH WHAT IT LABELS.
 *
 * The row label used to be `<label htmlFor={field.id}>` and no input carried
 * that id, so no label in the Studio named its input (a screen reader read
 * every field as unlabelled; clicking a label focused nothing). And the schema
 * id could not have been the answer: it repeats in every item of a group.
 */
const schema: FormSchemaConfig = {
  sections: [
    {
      id: "s",
      title: "section",
      fields: [
        { id: "name", type: "text", label: "label.name", required: true },
        { id: "note", type: "textarea", label: "label.note" },
        { id: "when", type: "date", label: "label.when" },
        { id: "on", type: "boolean", label: "label.on" },
        { id: "pick", type: "select", label: "label.pick", options: [{ value: "a", label: "a" }] },
        { id: "size", type: "range", label: "label.size", min: 0, max: 10 },
        { id: "photo", type: "image", label: "label.photo" },
        {
          id: "items",
          type: "group",
          label: "label.items",
          minItems: 1,
          maxItems: 3,
          // `text` here and in `more` below: the same item-field id in two groups.
          itemFields: [{ id: "text", type: "textarea", label: "label.itemText" }],
        },
        { id: "more", type: "group", label: "label.more", minItems: 1, maxItems: 2, itemFields: [{ id: "text", type: "text", label: "label.moreText" }] },
      ],
    },
  ],
};

function renderForm() {
  return render(
    <GenericForm
      schema={schema}
      values={{ items: [{ text: "" }, { text: "" }], more: [{ text: "" }] }}
      themeSelections={{}}
      errors={{}}
      onChange={vi.fn()}
    />
  );
}

describe("GenericForm label association", () => {
  it.each([
    ["label.name", "INPUT", "text"],
    ["label.note", "TEXTAREA", null],
    ["label.when", "INPUT", "date"],
    ["label.on", "INPUT", "checkbox"],
    ["label.pick", "SELECT", null],
    ["label.size", "INPUT", "range"],
  ])("%s names its own control", (label, tag, type) => {
    renderForm();
    const control = screen.getByLabelText(new RegExp(`^${label.replace(".", "\.")}`));
    expect(control.tagName).toBe(tag);
    if (type) expect(control.getAttribute("type")).toBe(type);
  });

  it("gives each group item's field its own control, even when ids repeat across items and groups", () => {
    renderForm();
    const itemTexts = screen.getAllByLabelText("label.itemText");
    expect(itemTexts).toHaveLength(2);
    expect(itemTexts[0]).not.toBe(itemTexts[1]);
    expect(itemTexts.every((el) => el.tagName === "TEXTAREA")).toBe(true);
    expect(screen.getByLabelText("label.moreText").tagName).toBe("INPUT");
  });

  it("names a field with no single control as a group, and its file input by the same heading", () => {
    renderForm();
    const photo = screen.getByRole("group", { name: "label.photo" });
    expect(photo.querySelector('input[type="file"]')).toHaveAccessibleName("label.photo");
    expect(screen.getByRole("group", { name: /^label\.items/ })).toBeInTheDocument();
  });

  it("leaves no label pointing at an element that does not exist", () => {
    const { container } = renderForm();
    const labels = [...container.querySelectorAll("label[for]")];
    expect(labels.length).toBeGreaterThanOrEqual(7);
    for (const label of labels) {
      expect(document.getElementById(label.getAttribute("for")!), label.textContent ?? "").not.toBeNull();
    }
    const ids = labels.map((label) => label.getAttribute("for"));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("GenericForm: nested groups, hidden sections, swatches and live help", () => {
  const nested: FormSchemaConfig = {
    sections: [
      {
        id: "messages",
        title: "messages",
        fields: [
          {
            id: "groups",
            type: "group",
            label: "label.group",
            minItems: 1,
            maxItems: 3,
            itemFields: [
              {
                id: "people",
                type: "group",
                label: "label.person",
                minItems: 1,
                maxItems: 3,
                itemFields: [
                  { id: "name", type: "text", label: "label.name", required: true },
                  { id: "colour", type: "swatch", label: "label.colour", options: [{ value: "coral", label: "colour.coral", color: "#ff6b4a" }] },
                  { id: "voice", type: "text", label: "label.voice", helpText: "help.count", helpTextParams: (values) => ({ used: (values.groups as unknown[]).length }) },
                ],
              },
            ],
          },
        ],
      },
      { id: "airline", title: "section.airline", visibleWhen: [{ path: "theme.journey", op: "eq", value: "airline" }], fields: [{ id: "seat", type: "text", label: "label.seat" }] },
    ],
  };
  const values = { groups: [{ people: [{ name: "" }] }, { people: [{ name: "Ada" }] }] };

  it("shows an error on a field inside a group inside a group", () => {
    render(
      <GenericForm
        schema={nested}
        values={values}
        themeSelections={{ journey: "space" }}
        errors={{ "groups.0.people.0.name": { code: "required", params: { label: "label.name" } } }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("label.name is required.")).toBeInTheDocument();
  });

  it("hides a section, heading and all, while its visibleWhen fails", () => {
    const { rerender } = render(<GenericForm schema={nested} values={values} themeSelections={{ journey: "space" }} errors={{}} onChange={vi.fn()} />);
    expect(screen.queryByText("section.airline")).toBeNull();
    rerender(<GenericForm schema={nested} values={values} themeSelections={{ journey: "airline" }} errors={{}} onChange={vi.fn()} />);
    expect(screen.getByText("section.airline")).toBeInTheDocument();
  });

  it("draws a swatch field as a named radio group with an automatic choice", () => {
    const onChange = vi.fn();
    render(<GenericForm schema={nested} values={values} themeSelections={{}} errors={{}} onChange={onChange} />);
    const group = screen.getAllByRole("radiogroup", { name: /^label\.colour/ })[0]!;
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["Automatic", "colour.coral"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });

  it("fills a help text's placeholders from the WHOLE form, also inside a group", () => {
    render(<GenericForm schema={nested} values={values} themeSelections={{}} errors={{}} onChange={vi.fn()} />);
    // Computed from all groups (2 of them), not from the one item it sits in.
    expect(screen.getAllByText("2 of 5 used in this keepsake.").length).toBe(2);
  });
});
