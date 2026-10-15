import type { FormSchemaConfig } from "@/types/studio";
import { timelineMetadata } from "./metadata";
import { MAX_PEOPLE, MIN_PEOPLE, STORY_TYPES } from "./story-types";
import { MUSIC_PRESETS } from "./music-presets";
import { SHOW_MILESTONE_VIDEO } from "@/lib/feature-flags";

/**
 * ---------------------------------------------------------------------
 * THE CANONICAL STORY (§3, §4, §20)
 * ---------------------------------------------------------------------
 * §20's principle is that the customer creates the story ONCE and every
 * experience reads from it. This schema is that single source: print,
 * digital, wallpapers and AR all derive from these fields and none of them
 * asks the customer to enter anything twice.
 *
 * WHAT CHANGED, AND WHY EACH
 *
 * `partner1`/`partner2` became `people` (§16). Two hardcoded name slots
 * made the product couple-only: a gift buyer is not in the story at all,
 * and a family story may name just one person. The story type decides what
 * they are called; the count is 1–2 for every type (`MAX_PEOPLE`).
 *
 * Milestones are 3 to `timelineMetadata.maxEvents`, not 1–5 (§4). A
 * timeline with one point is not a timeline; every composition is a
 * sequence. The upper bound lives in `metadata.ts`, with its history.
 *
 * A milestone photo is now REQUIRED (§4). This reverses an earlier decision
 * where it was optional, and it is a real narrowing — a customer with dates
 * and words but no photographs can no longer buy this. Confirmed
 * deliberately, and every layout in §7 is photo-led, which is what makes it
 * coherent rather than arbitrary.
 *
 * `location` is new and optional (§4).
 *
 * Text ceilings were raised: titles 22→40, descriptions 55→140. §19 forbids
 * solving overflow by shrinking type to an unreasonable size, so a ceiling
 * has to exist somewhere; these are wide enough for a real sentence and
 * narrow enough that six compositions can hold their shape.
 */
export const timelineSchema: FormSchemaConfig = {
  sections: [
    /*
      §9 — split from one "Your Story" section carrying nine fields into
      four small ones. The section renderer already produces exactly what
      §9 asks for — a subtle uppercase label and generous spacing, no card
      wrapper (`generic-form.tsx`) — so this is a data reorganization, not
      new UI: reusing that mechanism at a finer grain is what turns "one
      continuous block" into "clearly separated logical groups" for free.
    */
    {
      id: "storyBasics",
      title: "sections.storyBasics",
      fields: [
        {
          // §16 — chosen first, because it changes the labels of everything
          // below it. Not a cosmetic preset: it decides how many names the
          // story expects and how the finished piece refers to them.
          id: "storyType",
          type: "select",
          label: "fields.storyType.label",
          helpText: "fields.storyType.help",
          required: true,
          options: STORY_TYPES.map((type) => ({
            value: type.id,
            label: `storyTypes.${type.i18nKey}.name`,
          })),
        },
        {
          // Replaces partner1/partner2. One bound for every story type
          // (`MAX_PEOPLE`, mirrored by the backend validator).
          id: "people",
          type: "group",
          label: "fields.people.label",
          minItems: MIN_PEOPLE,
          maxItems: MAX_PEOPLE,
          itemFields: [
            { id: "name", type: "text", label: "fields.personName.label", required: true, maxLength: 24 },
          ],
        },
      ],
    },
    {
      id: "storyText",
      title: "sections.storyText",
      fields: [
        {
          // §3 — Heartfolio proposes one per story type; the customer can
          // always edit it, which §17 requires.
          id: "posterTitle",
          type: "text",
          label: "fields.posterTitle.label",
          maxLength: 40,
          placeholder: "fields.posterTitle.placeholder",
        },
        { id: "subtitle", type: "text", label: "fields.subtitle.label", maxLength: 60 },
        // §3's dedication/message. Was called `quote`; renamed because a
        // dedication is what customers actually write here, and the label
        // shapes what they produce.
        { id: "dedication", type: "textarea", label: "fields.dedication.label", maxLength: 180 },
        { id: "endingText", type: "text", label: "fields.endingText.label", maxLength: 40, placeholder: "fields.endingText.placeholder" },
      ],
    },
    {
      id: "music",
      title: "sections.music",
      fields: [
        /*
          §5 — background music for the Digital experience. Story-level
          rather than per-milestone: it plays across the whole journey, and
          a track per milestone would mean audio cutting in and out as
          someone scrolls.
          §10 requires it to be user-controlled rather than autoplaying, so
          providing it here is not the same as forcing anyone to hear it.
        */
        {
          /*
            §4 — a preset selection, not a free upload. "none" is a real
            entry in MUSIC_PRESETS, not a special case bolted on here — see
            that file for why, and for the explicit instrumental/no-vocals
            constraint on whatever presets actually ship.

            Default value lives in `createInitialState()`, matching
            `storyType` immediately above it in this same section — not a
            schema-level property, since `SelectFieldSchema` has none.
          */
          id: "backgroundMusic",
          type: "select",
          label: "fields.backgroundMusic.label",
          helpText: "fields.backgroundMusic.help",
          options: MUSIC_PRESETS.map((preset) => ({
            value: preset.id,
            label: `music.presets.${preset.i18nKey}.name`,
          })),
        },
      ],
    },
    {
      id: "storyOptions",
      title: "sections.storyOptions",
      fields: [
        { id: "showDuration", type: "boolean", label: "fields.showDuration.label", helpText: "fields.showDuration.help" },
        { id: "autoSort", type: "boolean", label: "fields.autoSort.label", helpText: "fields.autoSort.help" },
      ],
    },
    {
      id: "milestones",
      title: "sections.milestones",
      fields: [
        {
          id: "events",
          type: "group",
          label: "fields.events.label",
          minItems: timelineMetadata.minEvents,
          maxItems: timelineMetadata.maxEvents,
          itemFields: [
            { id: "date", type: "date", label: "fields.eventDate.label", required: true },
            { id: "title", type: "text", label: "fields.eventTitle.label", required: true, maxLength: 40 },
            { id: "description", type: "textarea", label: "fields.eventDescription.label", maxLength: 140 },
            {
              // §6 — the 40-character cap on the place name is enforced
              // server-side (`_location_field`'s `max_length`); there is
              // no client-facing `maxLength` on `LocationFieldSchema`
              // itself, since it describes an object value, not a string
              // the generic text-length UI could apply to directly.
              id: "location",
              type: "location",
              label: "fields.eventLocation.label",
            },
            /*
              §5 — OPTIONAL enhancements, and the word optional is
              load-bearing. The plan is explicit that a Love Story Timeline
              must be valuable with only the core story and photos, and
              that customers must never be forced to provide media to make
              Digital or AR valid.
              These appear on the printable deliverables not at all: a
              poster cannot play a voice note. They enrich the Digital and
              AR experiences, which is where §5 places them.
            */
            /*
              VIDEO UPLOAD IS WITHHELD FROM THE STUDIO FOR NOW — a launch
              decision, not a technical one. Spread in conditionally rather
              than deleted, so the field definition, its labels in all
              three locales, and every downstream path it feeds stay intact
              and typechecked. Flip SHOW_MILESTONE_VIDEO to release it.

              Everything behind this still works and is exercised: upload
              validation, storage, promotion to permanent on payment, and
              AR playback. Only the way to supply one is hidden.
            */
            ...(SHOW_MILESTONE_VIDEO
              ? [
                  {
                    id: "video",
                    type: "video" as const,
                    label: "fields.eventVideo.label",
                    helpText: "fields.eventVideo.help",
                  },
                ]
              : []),
            // 30 seconds: the backend's audio cap is now 60 (for Graduation
            // Keepsake's voice messages), so this product's own limit lives
            // here, in the recorder, which stops itself at 30.
            { id: "audio", type: "audio", label: "fields.eventAudio.label", helpText: "fields.eventAudio.help", maxSeconds: 30 },
            // Required as of §4. Every composition in §7 is photo-led.
            { id: "photo", type: "image", label: "fields.eventPhoto.label", required: true },
          ],
        },
      ],
    },
  ],
};
