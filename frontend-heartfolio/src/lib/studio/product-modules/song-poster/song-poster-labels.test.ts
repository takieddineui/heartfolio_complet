import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExportTargets } from "@/types/studio";
import { songPosterExports } from "./exports";
import { songPosterMessages } from "./messages";
import { SONG_POSTER_THEMES } from "./theme-registry";

const LOCALES = ["en", "fr", "ar"] as const;

/**
 * SONG POSTER'S STUDIO AND PRODUCT PAGE SAY WHAT IS TRUE (19 Oct 2026).
 * Its export list showed raw keys, and the product page promised "the actual
 * waveform of the track you choose": the waveform is a shape seeded per order
 * (`waveform.ts`), never read from the recording, and the Studio requires a
 * YouTube link, not just a title and artist.
 */
describe("song-poster's export labels", () => {
  it.each(LOCALES)("label every target of every theme in %s's own words", (locale) => {
    for (const theme of SONG_POSTER_THEMES) {
      const formats = Object.values(resolveExportTargets(songPosterExports, { theme: theme.id })).flat();
      expect(formats).toHaveLength(9);
      for (const format of formats) {
        expect(songPosterMessages[locale]?.[format.label], `${theme.id} ${locale} ${format.label}`).toBeTruthy();
      }
    }
  });
});

const page = (locale: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "messages", `${locale}.json`), "utf8")).Products
    .songPoster as Record<string, unknown>;

describe("song-poster's product page", () => {
  it.each([
    ["en", /actual waveform|song's waveform|beneath the waveform|identify by title and artist/i],
    ["fr", /onde réelle|forme d'onde|sous l'onde|identifier par son titre/i],
    ["ar", /الموجة الفعلية|شكل الموجة|تحت الموجة|تحديدها بالاسم/],
  ])("never claims the recording's own waveform in %s", (locale, claim) => {
    expect(JSON.stringify(page(locale))).not.toMatch(claim);
  });

  it.each([
    ["en", "YouTube", "not taken from the recording"],
    ["fr", "YouTube", "pas tirée de l'enregistrement"],
    ["ar", "يوتيوب", "ليست مأخوذة من التسجيل"],
  ])("answers in the FAQ, in %s, that a song needs a YouTube link and the soundwave is designed", (locale, link, designed) => {
    const faq = page(locale).faq as { answer: string }[];
    expect(faq[0]!.answer).toContain(link);
    expect(faq[0]!.answer).toContain(designed);
  });
});
