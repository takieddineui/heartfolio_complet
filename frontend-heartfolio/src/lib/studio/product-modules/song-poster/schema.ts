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
 * `youtubeUrl` is `type: "youtube"` (`youtube-field-input.tsx`): it checks
 * the link with `YouTubeValidateView` as soon as it is recognised and
 * stores the confirmed id in `youtubeVideoId`, which `validation.ts`
 * requires before checkout. Until 15 Oct 2026 it was plain text and
 * NOTHING called the check, so `youtubeVideoId` was never set and no
 * customer could reach checkout at all.
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
          type: "youtube",
          confirmedIdField: "youtubeVideoId",
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
