/**
 * Writes the marketing sample projects to
 * `backend/apps/delivery/marketing_samples/samples.json`.
 *
 * THE STUDIO'S OWN SAMPLES, PLUS PHOTOS. Each product starts from the same
 * `createInitialState(locale)` a customer sees when they open the Studio, so
 * the captures show real, valid content in all three languages, then adds
 * what a marketing capture needs and a fresh Studio deliberately leaves out:
 * photographs (licensed stock, see `PHOTOS.md`), a fourth Love Story
 * Timeline milestone, and Song Poster's fictional song. Everything here is
 * fictional; nothing comes from a customer.
 *
 * A photo is written as `{ "$photo": "<file in photos/>" }`. The backend's
 * `render_marketing_samples` uploads that file through the real upload
 * pipeline and swaps in the asset's id, so the samples carry no ids.
 *
 * Run from `frontend-heartfolio/` (re-run whenever a Studio sample changes):
 *   JITI_ALIAS='{"@":"<abs path>/src"}' npx jiti scripts/captures/export-samples.ts
 * `scripts/captures/record.mjs samples` does exactly that.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as lst from "@/lib/studio/product-modules/love-story-timeline/initial-state";
import * as reasons from "@/lib/studio/product-modules/reasons-i-love-you/initial-state";
import * as graduation from "@/lib/studio/product-modules/graduation-keepsake/initial-state";
import * as song from "@/lib/studio/product-modules/song-poster/initial-state";

type Locale = "en" | "fr" | "ar";
const LOCALES: Locale[] = ["en", "fr", "ar"];
const photo = (file: string) => ({ $photo: file });

/** Love Story Timeline: the Studio's three milestones, a fourth, and a photo
 *  on each. Four, not five: enough for a timeline to read as a story without
 *  crowding the phone. */
const LST_FOURTH: Record<Locale, { title: string; description: string; location: string }> = {
  en: { title: "Our First Home", description: "Three rooms, one wobbly table, all ours.", location: "Porto" },
  fr: { title: "Notre premier chez-nous", description: "Trois pièces, une table bancale, rien qu'à nous.", location: "Porto" },
  ar: { title: "بيتنا الأول", description: "ثلاث غرف، وطاولة تتمايل، وكلها لنا.", location: "بورتو" },
};
const LST_PHOTOS = ["lst-met-umbrella.jpg", "lst-trip-road.jpg", "lst-proposal-beach.jpg", "lst-home-keys.jpg"];

function loveStoryTimeline(locale: Locale) {
  const values = lst.createInitialState(locale);
  values.events.push({ date: "2024-03-15", ...LST_FOURTH[locale] });
  return {
    values: {
      ...values,
      events: values.events.map((event, index) => ({ ...event, photo: photo(LST_PHOTOS[index]!) })),
    },
    themeSelections: lst.createInitialThemeSelections(),
  };
}

/** Reasons I Love You: a photo on four of the five reasons; the first stays
 *  text only, as many real ones will. */
const REASON_PHOTOS: (string | null)[] = [null, "reasons-pancakes.jpg", "reasons-coffee.jpg", "reasons-drive.jpg", "reasons-hands.jpg"];

function reasonsILoveYou(locale: Locale) {
  const values = reasons.createInitialState(locale);
  return {
    values: {
      ...values,
      reasons: values.reasons.map((reason, index) =>
        REASON_PHOTOS[index] ? { ...reason, photo: photo(REASON_PHOTOS[index]!) } : reason
      ),
    },
    themeSelections: reasons.createInitialThemeSelections(),
  };
}

/** Graduation Keepsake: every photo slot is required (`data.py`), one per
 *  stop included, so the Studio's four stops become three (school, the Lego
 *  phase, the studio all-nighter; the art prize is dropped) to keep the
 *  photo count down. Sound off: the captures are silent. */
const GRAD_STOPS: [number, string][] = [
  [0, "grad-school.jpg"],
  [1, "grad-lego.jpg"],
  [3, "grad-plans.jpg"],
];

function graduationKeepsake(locale: Locale) {
  const values = graduation.createInitialState(locale);
  return {
    values: {
      ...values,
      gradPhoto: photo("grad-caps.jpg"),
      thenPhoto: photo("grad-drawing.jpg"),
      stops: GRAD_STOPS.map(([index, file]) => ({ ...values.stops[index]!, photo: photo(file) })),
      nextPhoto: photo("grad-copenhagen.jpg"),
      sound: false,
    },
    themeSelections: graduation.createInitialThemeSelections(),
  };
}

/** Song Poster: a FICTIONAL song and band (owner's decision). The YouTube id
 *  is deliberately fake but well formed, so the backend's validation accepts
 *  it; the capture page stubs the player, so nothing ever requests it. */
const SONG: Record<Locale, { track: string; artist: string; dedication: string }> = {
  en: { track: "Slow Dance in the Kitchen", artist: "The Late Lanterns", dedication: "For every night we danced before the dishes were done." },
  fr: { track: "Slow dans la cuisine", artist: "Les Lanternes", dedication: "Pour tous les soirs où l'on a dansé avant la vaisselle." },
  ar: { track: "رقصة في المطبخ", artist: "فرقة الفوانيس", dedication: "لكل ليلة رقصنا فيها قبل أن ننتهي من الصحون." },
};
const FAKE_VIDEO_ID = "HeartfolioS";

function songPoster(locale: Locale) {
  return {
    values: {
      ...song.createInitialState(),
      ...SONG[locale],
      photo: photo("song-turntable.jpg"),
      youtubeUrl: `https://www.youtube.com/watch?v=${FAKE_VIDEO_ID}`,
      youtubeVideoId: FAKE_VIDEO_ID,
    },
    themeSelections: song.createInitialThemeSelections(),
  };
}

const BUILDERS = {
  "love-story-timeline": loveStoryTimeline,
  "reasons-i-love-you": reasonsILoveYou,
  "graduation-keepsake": graduationKeepsake,
  "song-poster": songPoster,
} as const;

const samples = Object.fromEntries(
  Object.entries(BUILDERS).map(([product, build]) => [
    product,
    Object.fromEntries(LOCALES.map((locale) => [locale, { version: 1, ...build(locale) }])),
  ])
);

const target = resolve(process.cwd(), "../backend/apps/delivery/marketing_samples/samples.json");
writeFileSync(target, JSON.stringify(samples, null, 2) + "\n", "utf8");
console.log(`wrote ${target}`);
