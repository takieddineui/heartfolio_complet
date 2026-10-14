import type { FieldSchema, FormSchemaConfig } from "@/types/studio";
import { REASONS_LIMITS as L } from "./limits";

/**
 * The Studio form. Reasons are add/remove only, like Love Story Timeline's
 * milestones (no drag to reorder in v1, by decision).
 *
 * THE LETTER'S FIELDS ARE NOT `required` HERE, on purpose. The shared
 * validator (`form-engine.ts`) checks `required` without looking at
 * `visibleWhen`, so a required greeting would block a customer who switched
 * the letter OFF. "Required while the letter is on" is enforced in this
 * module's own `validation.ts` instead, and by the backend.
 */
export const reasonsSchema: FormSchemaConfig = {
  sections: [
    {
      id: "names",
      title: "sections.names",
      fields: [
        { id: "toName", type: "text", label: "fields.toName.label", required: true, maxLength: L.nameMaxLength },
        { id: "fromName", type: "text", label: "fields.fromName.label", required: true, maxLength: L.nameMaxLength },
        {
          id: "title",
          type: "text",
          label: "fields.title.label",
          helpText: "fields.title.help",
          placeholder: "fields.title.placeholder",
          maxLength: L.titleMaxLength,
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "reasons",
      title: "sections.reasons",
      fields: [
        {
          id: "reasons",
          type: "group",
          label: "fields.reasons.label",
          minItems: L.minReasons,
          maxItems: L.maxReasons,
          itemFields: [
            { id: "text", type: "textarea", label: "fields.reasonText.label", required: true, maxLength: L.reasonMaxLength },
            { id: "photo", type: "image", label: "fields.reasonPhoto.label" },
            {
              id: "memory",
              type: "text",
              label: "fields.reasonMemory.label",
              placeholder: "fields.reasonMemory.placeholder",
              maxLength: L.memoryMaxLength,
            },
          ],
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "finale",
      title: "sections.finale",
      fields: [
        {
          id: "finaleTeaser",
          type: "text",
          label: "fields.finaleTeaser.label",
          placeholder: "fields.finaleTeaser.placeholder",
          maxLength: L.teaserMaxLength,
        },
        { id: "finaleLine", type: "textarea", label: "fields.finaleLine.label", required: true, maxLength: L.finaleLineMaxLength },
        {
          id: "signature",
          type: "text",
          label: "fields.signature.label",
          helpText: "fields.signature.help",
          maxLength: L.signatureMaxLength,
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "letter",
      title: "sections.letter",
      fields: [
        { id: "letterEnabled", type: "boolean", label: "fields.letterEnabled.label" },
        {
          id: "letterGreeting",
          type: "text",
          label: "fields.letterGreeting.label",
          maxLength: L.greetingMaxLength,
          visibleWhen: [{ path: "values.letterEnabled", op: "eq", value: true }],
        },
        {
          id: "letterParagraphs",
          type: "group",
          label: "fields.letterParagraphs.label",
          // 0, not 1: a group's minimum is enforced by the shared validator
          // whether or not the group is visible (see the note above). One
          // paragraph is required in `validation.ts` while the letter is on.
          minItems: 0,
          maxItems: L.maxParagraphs,
          visibleWhen: [{ path: "values.letterEnabled", op: "eq", value: true }],
          itemFields: [{ id: "text", type: "textarea", label: "fields.letterParagraph.label", maxLength: L.paragraphMaxLength }],
        },
        {
          id: "letterSignoff",
          type: "text",
          label: "fields.letterSignoff.label",
          maxLength: L.signoffMaxLength,
          visibleWhen: [{ path: "values.letterEnabled", op: "eq", value: true }],
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "options",
      title: "sections.options",
      fields: [
        { id: "music", type: "boolean", label: "fields.music.label", helpText: "fields.music.help" },
        { id: "showShare", type: "boolean", label: "fields.showShare.label" },
      ] satisfies FieldSchema[],
    },
  ],
};
