import type { FieldSchema, FormSchemaConfig } from "@/types/studio";

/**
 * ---------------------------------------------------------------------
 * THE SONG (track, artist, the YouTube link) AND THE PHOTO
 * ---------------------------------------------------------------------
 * Four fields, deliberately: this product asks for less than Love Story
 * Timeline, not more. No audio file is ever uploaded (see
 * `apps/common/youtube.py`'s module docstring for why — no licensing
 * exposure, YouTube hosts the video, Heartfolio only embeds it) and
 * there is no milestone list — one song, one moment, one photo.
 *
 * `youtubeUrl` is `type: "text"`, not a dedicated field type. The
 * richer inline experience — a thumbnail preview once validated, a
 * spinner while `YouTubeValidateView` is checking — would need a new
 * Shell field renderer (`field-inputs.tsx` is shared across every
 * product), which is real, separate work with its own blast radius.
 * Plain text is what proves the pipeline end to end first: paste a
 * link, validate it before checkout, see the real embed play in
 * `PlayerTheme`. Upgrading the input itself is a follow-up, not a
 * blocker to any of that working.
 */
export const songPosterSchema: FormSchemaConfig = {
  sections: [
    {
      id: "song",
      title: "sections.song",
      fields: [
        { id: "track", type: "text", label: "fields.track.label", required: true, maxLength: 60 },
        { id: "artist", type: "text", label: "fields.artist.label", required: true, maxLength: 60 },
        {
          id: "youtubeUrl",
          type: "text",
          label: "fields.youtubeUrl.label",
          helpText: "fields.youtubeUrl.help",
          required: true,
          maxLength: 300,
          placeholder: "fields.youtubeUrl.placeholder",
        },
      ] satisfies FieldSchema[],
    },
    {
      id: "message",
      title: "sections.message",
      fields: [
        { id: "dedication", type: "textarea", label: "fields.dedication.label", maxLength: 180 },
      ] satisfies FieldSchema[],
    },
    {
      id: "photo",
      title: "sections.photo",
      fields: [
        { id: "photo", type: "image", label: "fields.photo.label", required: true } satisfies FieldSchema,
      ],
    },
  ],
};
