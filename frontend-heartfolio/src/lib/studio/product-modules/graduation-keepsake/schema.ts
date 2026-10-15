import type { Condition, FieldSchema, FormSchemaConfig } from "@/types/studio";
import { COLOUR_IDS, COLOURS } from "./journeys";
import { GRADUATION_LIMITS as L } from "./limits";

/**
 * The Studio form.
 *
 * CHAPTERS SWITCH ON AND OFF: each chapter's section starts with its switch,
 * and its fields carry `visibleWhen` that switch. Their `required` holds only
 * while the chapter is on, because the form engine skips a hidden field
 * (`form-engine.ts`). The order of the chapters is fixed (no drag to reorder,
 * by decision, as Reasons I Love You).
 *
 * AIRLINE ONLY: the boarding pass section (`visibleWhen` on the SECTION) and
 * the three-letter codes on stops and goals (`visibleWhen` the journey, read
 * from the theme even inside a group item).
 *
 * VOICE MESSAGES AND DRAWINGS: optional on each person, at most 5 of each in
 * the whole keepsake (`limits.ts`). Their help text counts how many are used
 * across every group, and `validation.ts` refuses a sixth.
 */
const on = (key: string): Condition[] => [{ path: `values.${key}`, op: "eq", value: true }];
const airline: Condition[] = [{ path: "theme.journey", op: "eq", value: "airline" }];

/** How many people in the whole keepsake have a voice message (or drawing). */
export function countMedia(values: Record<string, unknown>, key: "voice" | "drawing"): number {
  const groups = Array.isArray(values.messageGroups) ? values.messageGroups : [];
  let count = 0;
  for (const group of groups) {
    const people = Array.isArray((group as { people?: unknown })?.people) ? (group as { people: unknown[] }).people : [];
    for (const person of people) if ((person as Record<string, unknown>)?.[key]) count += 1;
  }
  return count;
}

const swatches = COLOUR_IDS.map((id) => ({ value: id, label: `colours.${id}`, color: COLOURS[id] }));

export const graduationSchema: FormSchemaConfig = {
  sections: [
    {
      id: "graduate",
      title: "sections.graduate",
      fields: [
        { id: "gradName", type: "text", label: "fields.gradName.label", required: true, maxLength: L.nameMaxLength },
        { id: "gradFullName", type: "text", label: "fields.gradFullName.label", required: true, maxLength: L.fullNameMaxLength },
        { id: "gradYear", type: "text", label: "fields.gradYear.label", required: true, maxLength: 4, placeholder: "fields.gradYear.placeholder" },
        { id: "gradDegree", type: "text", label: "fields.gradDegree.label", required: true, maxLength: L.degreeMaxLength },
        { id: "gradSchool", type: "text", label: "fields.gradSchool.label", required: true, maxLength: L.schoolMaxLength },
        { id: "gradDate", type: "date", label: "fields.gradDate.label", required: true },
        { id: "gradPhoto", type: "image", label: "fields.gradPhoto.label", required: true, helpText: "fields.gradPhoto.help" },
      ] satisfies FieldSchema[],
    },
    {
      id: "path",
      title: "sections.path",
      fields: [
        { id: "pathEnabled", type: "boolean", label: "fields.pathEnabled.label" },
        { id: "thenYear", type: "text", label: "fields.thenYear.label", required: true, maxLength: L.pathYearMaxLength, visibleWhen: on("pathEnabled") },
        { id: "thenText", type: "textarea", label: "fields.thenText.label", required: true, maxLength: L.pathTextMaxLength, visibleWhen: on("pathEnabled") },
        { id: "thenPhoto", type: "image", label: "fields.thenPhoto.label", required: true, visibleWhen: on("pathEnabled") },
        {
          id: "stops",
          type: "group",
          label: "fields.stops.label",
          minItems: L.minStops,
          maxItems: L.maxStops,
          visibleWhen: on("pathEnabled"),
          itemFields: [
            { id: "year", type: "text", label: "fields.stopYear.label", required: true, maxLength: L.pathYearMaxLength },
            { id: "caption", type: "text", label: "fields.stopCaption.label", required: true, maxLength: L.stopCaptionMaxLength },
            { id: "photo", type: "image", label: "fields.stopPhoto.label", required: true },
            { id: "code", type: "text", label: "fields.stopCode.label", maxLength: 3, helpText: "fields.code.help", visibleWhen: airline },
          ],
        },
        { id: "nowYear", type: "text", label: "fields.nowYear.label", required: true, maxLength: L.pathYearMaxLength, visibleWhen: on("pathEnabled") },
        { id: "nowText", type: "textarea", label: "fields.nowText.label", required: true, maxLength: L.pathTextMaxLength, helpText: "fields.nowText.help", visibleWhen: on("pathEnabled") },
        { id: "nextText", type: "textarea", label: "fields.nextText.label", required: true, maxLength: L.pathTextMaxLength, visibleWhen: on("pathEnabled") },
        { id: "nextPhoto", type: "image", label: "fields.nextPhoto.label", required: true, visibleWhen: on("pathEnabled") },
      ] satisfies FieldSchema[],
    },
    {
      id: "achievements",
      title: "sections.achievements",
      fields: [
        { id: "achievementsEnabled", type: "boolean", label: "fields.achievementsEnabled.label" },
        {
          id: "achievements",
          type: "group",
          label: "fields.achievements.label",
          minItems: L.minAchievements,
          maxItems: L.maxAchievements,
          visibleWhen: on("achievementsEnabled"),
          itemFields: [
            { id: "title", type: "text", label: "fields.achievementTitle.label", required: true, maxLength: L.achievementTitleMaxLength },
            { id: "detail", type: "text", label: "fields.achievementDetail.label", maxLength: L.achievementDetailMaxLength },
            { id: "place", type: "text", label: "fields.achievementPlace.label", maxLength: L.achievementPlaceMaxLength, visibleWhen: airline },
          ],
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "messages",
      title: "sections.messages",
      fields: [
        { id: "messagesEnabled", type: "boolean", label: "fields.messagesEnabled.label" },
        {
          id: "messageGroups",
          type: "group",
          label: "fields.messageGroups.label",
          minItems: L.minGroups,
          maxItems: L.maxGroups,
          visibleWhen: on("messagesEnabled"),
          itemFields: [
            { id: "label", type: "text", label: "fields.groupLabel.label", required: true, maxLength: L.groupLabelMaxLength, placeholder: "fields.groupLabel.placeholder" },
            {
              id: "people",
              type: "group",
              label: "fields.people.label",
              minItems: L.minPeople,
              maxItems: L.maxPeople,
              // A new group starts with one empty person, so it is not born
              // below its own minimum.
              defaultValue: [{ name: "", message: "" }],
              itemFields: [
                { id: "name", type: "text", label: "fields.personName.label", required: true, maxLength: L.personNameMaxLength },
                { id: "message", type: "textarea", label: "fields.personMessage.label", required: true, maxLength: L.messageMaxLength },
                { id: "color", type: "swatch", label: "fields.personColor.label", options: swatches },
                { id: "emoji", type: "text", label: "fields.personEmoji.label", maxLength: 16, maxGraphemes: 1, helpText: "fields.personEmoji.help" },
                {
                  id: "voice",
                  type: "audio",
                  label: "fields.personVoice.label",
                  allowUpload: true,
                  maxSeconds: L.voiceMaxSeconds,
                  helpText: "fields.personVoice.help",
                  helpTextParams: (values) => ({ used: countMedia(values, "voice"), max: L.maxVoices }),
                },
                {
                  id: "voiceCaption",
                  type: "textarea",
                  label: "fields.personVoiceCaption.label",
                  maxLength: L.voiceCaptionMaxLength,
                  helpText: "fields.personVoiceCaption.help",
                  visibleWhen: [{ path: "values.voice", op: "exists" }],
                },
                {
                  id: "drawing",
                  type: "image",
                  label: "fields.personDrawing.label",
                  helpText: "fields.personDrawing.help",
                  helpTextParams: (values) => ({ used: countMedia(values, "drawing"), max: L.maxDrawings }),
                },
              ],
            },
          ],
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "goals",
      title: "sections.goals",
      fields: [
        { id: "goalsEnabled", type: "boolean", label: "fields.goalsEnabled.label" },
        {
          id: "goals",
          type: "group",
          label: "fields.goals.label",
          minItems: L.minGoals,
          maxItems: L.maxGoals,
          visibleWhen: on("goalsEnabled"),
          itemFields: [
            { id: "text", type: "text", label: "fields.goalText.label", required: true, maxLength: L.goalMaxLength },
            { id: "code", type: "text", label: "fields.goalCode.label", maxLength: 3, helpText: "fields.code.help", visibleWhen: airline },
          ],
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "letter",
      title: "sections.letter",
      fields: [
        { id: "letterEnabled", type: "boolean", label: "fields.letterEnabled.label" },
        { id: "letterGreeting", type: "text", label: "fields.letterGreeting.label", required: true, maxLength: L.greetingMaxLength, visibleWhen: on("letterEnabled") },
        {
          id: "letterParagraphs",
          type: "group",
          label: "fields.letterParagraphs.label",
          minItems: L.minParagraphs,
          maxItems: L.maxParagraphs,
          visibleWhen: on("letterEnabled"),
          itemFields: [{ id: "text", type: "textarea", label: "fields.letterParagraph.label", required: true, maxLength: L.paragraphMaxLength }],
        },
        { id: "letterSignoff", type: "text", label: "fields.letterSignoff.label", maxLength: L.signoffMaxLength, visibleWhen: on("letterEnabled") },
        {
          id: "letterSignatures",
          type: "group",
          label: "fields.letterSignatures.label",
          minItems: L.minSignatures,
          maxItems: L.maxSignatures,
          visibleWhen: on("letterEnabled"),
          itemFields: [{ id: "name", type: "text", label: "fields.signatureName.label", required: true, maxLength: L.signatureMaxLength }],
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "ending",
      title: "sections.ending",
      fields: [
        { id: "endingLine", type: "text", label: "fields.endingLine.label", required: true, maxLength: L.endingLineMaxLength },
        { id: "endingSub", type: "text", label: "fields.endingSub.label", maxLength: L.endingSubMaxLength },
        { id: "sound", type: "boolean", label: "fields.sound.label", helpText: "fields.sound.help" },
        { id: "showShare", type: "boolean", label: "fields.showShare.label" },
      ] satisfies FieldSchema[],
    },
    {
      id: "flight",
      title: "sections.flight",
      // The boarding pass exists only on the airline journey.
      visibleWhen: airline,
      fields: [
        { id: "flightAirline", type: "text", label: "fields.flightAirline.label", maxLength: L.flightAirlineMaxLength, placeholder: "journeys.airline.defaultAirline" },
        { id: "flightNumber", type: "text", label: "fields.flightNumber.label", maxLength: L.flightNumberMaxLength, placeholder: "fields.flightNumber.placeholder" },
        { id: "flightSeat", type: "text", label: "fields.flightSeat.label", maxLength: L.flightSeatMaxLength, placeholder: "fields.flightSeat.placeholder" },
        { id: "flightCabin", type: "text", label: "fields.flightCabin.label", maxLength: L.flightCabinMaxLength, placeholder: "journeys.airline.defaultCabin" },
        { id: "flightFromCode", type: "text", label: "fields.flightFromCode.label", maxLength: 3, placeholder: "fields.flightFromCode.placeholder" },
        { id: "flightFromCity", type: "text", label: "fields.flightFromCity.label", maxLength: L.flightCityMaxLength, placeholder: "journeys.airline.defaultFrom" },
        { id: "flightToCode", type: "text", label: "fields.flightToCode.label", maxLength: 3, placeholder: "fields.flightToCode.placeholder" },
        { id: "flightToCity", type: "text", label: "fields.flightToCity.label", maxLength: L.flightCityMaxLength, placeholder: "journeys.airline.defaultTo" },
      ] satisfies FieldSchema[],
    },
  ],
};
