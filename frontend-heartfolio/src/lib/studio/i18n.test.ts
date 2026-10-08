import { describe, expect, it } from "vitest";
import { resolveValidationMessage } from "./i18n";
import { timelineMessages } from "./product-modules/love-story-timeline/messages";

/**
 * `resolveValidationMessage` used to hand `error.params.label` — a schema
 * i18n KEY like "fields.eventPhoto.label" — straight into `interpolate()`,
 * which does blind `{label}` substitution. The customer saw the literal
 * key string. These pin the fix: `label` must always be resolved text,
 * never a key, regardless of which validation code produced the error.
 */
describe("resolveValidationMessage", () => {
  it("never leaks a schema label key into a required-field message", () => {
    const message = resolveValidationMessage(
      { code: "required", params: { label: "fields.eventPhoto.label" } },
      "en",
      timelineMessages
    );
    expect(message).not.toContain("fields.eventPhoto.label");
    expect(message).not.toContain(".label");
  });

  it("resolves the label to real text, matching the field's own input", () => {
    // The point of using a shared key at all: the error message and the
    // field's own label must say the same thing, in whichever language.
    const message = resolveValidationMessage(
      { code: "required", params: { label: "fields.eventPhoto.label" } },
      "en",
      timelineMessages
    );
    expect(message).toContain("Photo");
  });

  it("fixes every validation code that carries a label param, not just 'required'", () => {
    // The bug was in the shared resolution path, not per-message — so
    // maxLength and minItems get the fix for free. Asserted directly
    // rather than trusted, since a future per-code special case could
    // reintroduce exactly this leak for one code while "required" stays
    // fixed.
    const maxLength = resolveValidationMessage(
      { code: "maxLength", params: { label: "fields.eventTitle.label", maxLength: 40 } },
      "en",
      timelineMessages
    );
    expect(maxLength).not.toContain("fields.eventTitle.label");
  });

  it("resolves the label in French and Arabic too", () => {
    for (const locale of ["fr", "ar"]) {
      const message = resolveValidationMessage(
        { code: "required", params: { label: "fields.eventPhoto.label" } },
        locale,
        timelineMessages
      );
      expect(message).not.toContain("fields.eventPhoto.label");
    }
  });

  it("still works for an error with no label param at all", () => {
    // Not every validation code necessarily carries a label — the fix must
    // not assume `params.label` exists.
    expect(() =>
      resolveValidationMessage({ code: "required", params: undefined }, "en", timelineMessages)
    ).not.toThrow();
  });

  it("falls back to the raw key only as an absolute last resort", () => {
    // An unresolvable key is still better shown than a blank error, but it
    // must never be the DEFAULT outcome for a real, mapped field.
    const message = resolveValidationMessage(
      { code: "required", params: { label: "fields.thisKeyDoesNotExist.label" } },
      "en",
      timelineMessages
    );
    expect(message).toContain("fields.thisKeyDoesNotExist.label");
  });
});
