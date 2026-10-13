import type { Condition, FieldSchema, FormSchemaConfig } from "@/types/studio";
import { LIMITS } from "./limits";
import { DEFAULT_PERSON_COLOR, DEFAULT_PERSON_EMOJI, PERSON_COLORS, PERSON_EMOJIS } from "./palette";

/**
 * ---------------------------------------------------------------------
 * ONE STORY, ENTERED ONCE (docs/graduation/graduation-customer-inputs.md)
 * ---------------------------------------------------------------------
 * The creator tells the graduation story a single time - then, the years,
 * now, what's next, achievements, messages, goals, a letter - and chooses a
 * JOURNEY (a theme axis, `themes.ts`) that tells it. Nothing is typed twice,
 * and chapter titles and labels come from the journey, not from the creator.
 *
 * CHAPTERS CAN BE SWITCHED OFF (`showPath`, ...). A field belonging to a
 * chapter carries `visibleWhen` on its switch, and the form engine skips a
 * field that is not visible, so an OFF chapter neither shows its fields nor
 * blocks Continue. The backend does the same (`data.py` drops an off
 * chapter entirely).
 *
 * JOURNEY-ONLY FIELDS (the airline's boarding pass, airport codes, passport
 * place) use `visibleWhen` on `theme.journey`.
 *
 * LIMITS come from `limits.ts`, which a test pins against the backend.
 */

const chapter = (flag: string): Condition[] => [{ path: `values.${flag}`, op: "eq", value: true }];
const airlineOnly: Condition[] = [{ path: "theme.journey", op: "eq", value: "airline" }];

/** Stamps a chapter's switch onto every field of the chapter. */
function inChapter(flag: string, fields: FieldSchema[]): FieldSchema[] {
  return fields.map((field) => ({ ...field, visibleWhen: [...chapter(flag), ...(field.visibleWhen ?? [])] }));
}

const path = "showPath";

export const graduationSchema: FormSchemaConfig = {
  sections: [
    {
      id: "setup",
      title: "sections.setup",
      fields: [
        {
          id: "language",
          type: "select",
          label: "fields.language.label",
          helpText: "fields.language.help",
          required: true,
          options: [
            { value: "en", label: "languages.en" },
            { value: "fr", label: "languages.fr" },
            { value: "ar", label: "languages.ar" },
          ],
        },
        { id: "showPath", type: "boolean", label: "fields.showPath.label", helpText: "fields.chapters.include" },
        { id: "showAchievements", type: "boolean", label: "fields.showAchievements.label", helpText: "fields.chapters.include" },
        { id: "showMessages", type: "boolean", label: "fields.showMessages.label", helpText: "fields.chapters.include" },
        { id: "showGoals", type: "boolean", label: "fields.showGoals.label", helpText: "fields.chapters.include" },
        { id: "showLetter", type: "boolean", label: "fields.showLetter.label", helpText: "fields.chapters.include" },
      ],
    },
    {
      id: "graduate",
      title: "sections.graduate",
      fields: [
        { id: "gradName", type: "text", label: "fields.gradName.label", required: true, maxLength: LIMITS.name },
        {
          id: "gradFullName",
          type: "text",
          label: "fields.gradFullName.label",
          required: true,
          maxLength: LIMITS.fullName,
        },
        { id: "gradDegree", type: "text", label: "fields.gradDegree.label", required: true, maxLength: LIMITS.degree },
        { id: "gradSchool", type: "text", label: "fields.gradSchool.label", required: true, maxLength: LIMITS.school },
        { id: "gradDate", type: "date", label: "fields.gradDate.label", required: true },
        {
          id: "gradPhoto",
          type: "image",
          label: "fields.gradPhoto.label",
          helpText: "fields.gradPhoto.help",
          required: true,
        },
      ],
    },
    {
      id: "path",
      title: "sections.path",
      fields: inChapter(path, [
        { id: "thenYear", type: "text", label: "fields.thenYear.label", required: true, maxLength: LIMITS.yearText },
        {
          id: "thenText",
          type: "textarea",
          label: "fields.thenText.label",
          required: true,
          maxLength: LIMITS.storyText,
        },
        { id: "thenPhoto", type: "image", label: "fields.thenPhoto.label", required: true },
        {
          id: "stops",
          type: "group",
          label: "fields.stops.label",
          helpText: "fields.stops.help",
          minItems: LIMITS.stops.min,
          maxItems: LIMITS.stops.max,
          itemFields: [
            { id: "year", type: "text", label: "fields.stopYear.label", required: true, maxLength: LIMITS.yearText },
            { id: "caption", type: "text", label: "fields.stopCaption.label", required: true, maxLength: LIMITS.caption },
            { id: "photo", type: "image", label: "fields.stopPhoto.label", required: true },
            {
              id: "code",
              type: "text",
              label: "fields.stopCode.label",
              helpText: "fields.stopCode.help",
              maxLength: LIMITS.codeLength,
              visibleWhen: airlineOnly,
            },
          ],
        },
        { id: "nowYear", type: "text", label: "fields.nowYear.label", required: true, maxLength: LIMITS.yearText },
        {
          id: "nowText",
          type: "textarea",
          label: "fields.nowText.label",
          helpText: "fields.nowText.help",
          required: true,
          maxLength: LIMITS.storyText,
        },
        {
          id: "nextText",
          type: "textarea",
          label: "fields.nextText.label",
          required: true,
          maxLength: LIMITS.storyText,
        },
        { id: "nextPhoto", type: "image", label: "fields.nextPhoto.label", required: true },
      ]),
    },
    {
      id: "achievements",
      title: "sections.achievements",
      fields: inChapter("showAchievements", [
        {
          id: "achievements",
          type: "group",
          label: "fields.achievements.label",
          helpText: "fields.achievements.help",
          minItems: LIMITS.achievements.min,
          maxItems: LIMITS.achievements.max,
          itemFields: [
            {
              id: "title",
              type: "text",
              label: "fields.achievementTitle.label",
              required: true,
              maxLength: LIMITS.achievementTitle,
            },
            {
              id: "detail",
              type: "text",
              label: "fields.achievementDetail.label",
              maxLength: LIMITS.achievementDetail,
            },
            {
              id: "place",
              type: "text",
              label: "fields.achievementPlace.label",
              helpText: "fields.achievementPlace.help",
              maxLength: LIMITS.achievementPlace,
              visibleWhen: airlineOnly,
            },
          ],
        },
      ]),
    },
    {
      id: "messages",
      title: "sections.messages",
      fields: inChapter("showMessages", [
        {
          id: "messageGroups",
          type: "group",
          label: "fields.messageGroups.label",
          helpText: "fields.messageGroups.help",
          minItems: LIMITS.messageGroups.min,
          maxItems: LIMITS.messageGroups.max,
          itemFields: [
            {
              id: "label",
              type: "text",
              label: "fields.groupLabel.label",
              placeholder: "fields.groupLabel.placeholder",
              required: true,
              maxLength: LIMITS.groupLabel,
            },
            {
              id: "people",
              type: "group",
              label: "fields.people.label",
              minItems: LIMITS.people.min,
              maxItems: LIMITS.people.max,
              // A freshly added message group starts with one person to fill
              // in, not an empty group that is invalid until a second click.
              defaultValue: [{ name: "", color: DEFAULT_PERSON_COLOR, emoji: DEFAULT_PERSON_EMOJI, message: "" }],
              itemFields: [
                { id: "name", type: "text", label: "fields.personName.label", required: true, maxLength: LIMITS.name },
                {
                  id: "color",
                  type: "select",
                  label: "fields.personColor.label",
                  defaultValue: DEFAULT_PERSON_COLOR,
                  options: PERSON_COLORS.map((c) => ({ value: c.id, label: `colors.${c.id}` })),
                },
                {
                  id: "emoji",
                  type: "select",
                  label: "fields.personEmoji.label",
                  helpText: "fields.personEmoji.help",
                  defaultValue: DEFAULT_PERSON_EMOJI,
                  options: PERSON_EMOJIS.map((e) => ({ value: e.id, label: `emojis.${e.id}` })),
                },
                {
                  id: "message",
                  type: "textarea",
                  label: "fields.personMessage.label",
                  required: true,
                  maxLength: LIMITS.message,
                },
                {
                  // Record OR upload: the organiser gathers these from other
                  // people, so unlike Love Story Timeline's record-only
                  // voice note, a file they were sent must be attachable.
                  id: "voice",
                  type: "audio",
                  label: "fields.personVoice.label",
                  helpText: "fields.personVoice.help",
                  allowUpload: true,
                  maxSeconds: LIMITS.voiceSeconds,
                },
                { id: "drawing", type: "image", label: "fields.personDrawing.label" },
              ],
            },
          ],
        },
      ]),
    },
    {
      id: "goals",
      title: "sections.goals",
      fields: inChapter("showGoals", [
        {
          id: "goals",
          type: "group",
          label: "fields.goals.label",
          helpText: "fields.goals.help",
          minItems: LIMITS.goals.min,
          maxItems: LIMITS.goals.max,
          itemFields: [
            { id: "text", type: "text", label: "fields.goalText.label", required: true, maxLength: LIMITS.goal },
            {
              id: "code",
              type: "text",
              label: "fields.goalCode.label",
              helpText: "fields.goalCode.help",
              maxLength: LIMITS.codeLength,
              visibleWhen: airlineOnly,
            },
          ],
        },
      ]),
    },
    {
      id: "letter",
      title: "sections.letter",
      fields: inChapter("showLetter", [
        {
          id: "letterGreeting",
          type: "text",
          label: "fields.letterGreeting.label",
          required: true,
          maxLength: LIMITS.greeting,
        },
        {
          id: "letterBody",
          type: "group",
          label: "fields.letterBody.label",
          minItems: LIMITS.letterBody.min,
          maxItems: LIMITS.letterBody.max,
          itemFields: [
            {
              id: "text",
              type: "textarea",
              label: "fields.letterParagraph.label",
              required: true,
              maxLength: LIMITS.paragraph,
            },
          ],
        },
        { id: "letterSignoff", type: "text", label: "fields.letterSignoff.label", maxLength: LIMITS.signoff },
        {
          id: "letterSignatures",
          type: "group",
          label: "fields.letterSignatures.label",
          minItems: LIMITS.signatures.min,
          maxItems: LIMITS.signatures.max,
          itemFields: [
            { id: "name", type: "text", label: "fields.signatureName.label", required: true, maxLength: LIMITS.signature },
          ],
        },
      ]),
    },
    {
      id: "ending",
      title: "sections.ending",
      fields: [
        {
          id: "endingLine",
          type: "text",
          label: "fields.endingLine.label",
          required: true,
          maxLength: LIMITS.endingLine,
        },
        { id: "endingSub", type: "text", label: "fields.endingSub.label", maxLength: LIMITS.endingSub },
        { id: "soundEnabled", type: "boolean", label: "fields.soundEnabled.label", helpText: "fields.soundEnabled.help" },
        { id: "shareEnabled", type: "boolean", label: "fields.shareEnabled.label", helpText: "fields.shareEnabled.help" },
        { id: "brandingShow", type: "boolean", label: "fields.brandingShow.label", helpText: "fields.brandingShow.help" },
      ],
    },
    {
      id: "boardingPass",
      title: "sections.boardingPass",
      fields: [
        {
          id: "flightAirline",
          type: "text",
          label: "fields.flightAirline.label",
          helpText: "fields.flightAirline.help",
          maxLength: LIMITS.flightField,
        },
        { id: "flightNumber", type: "text", label: "fields.flightNumber.label", maxLength: LIMITS.flightNumber },
        { id: "flightSeat", type: "text", label: "fields.flightSeat.label", maxLength: LIMITS.flightSeat },
        { id: "flightCabin", type: "text", label: "fields.flightCabin.label", maxLength: LIMITS.flightField },
        {
          id: "flightFromCode",
          type: "text",
          label: "fields.flightFromCode.label",
          helpText: "fields.flightCode.help",
          maxLength: LIMITS.codeLength,
        },
        { id: "flightFromPlace", type: "text", label: "fields.flightFromPlace.label", maxLength: LIMITS.flightPlace },
        { id: "flightToCode", type: "text", label: "fields.flightToCode.label", maxLength: LIMITS.codeLength },
        { id: "flightToPlace", type: "text", label: "fields.flightToPlace.label", maxLength: LIMITS.flightPlace },
      ].map((field) => ({ ...field, visibleWhen: airlineOnly })) as FieldSchema[],
    },
  ],
};
