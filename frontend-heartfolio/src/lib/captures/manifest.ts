/**
 * The storefront's product captures (`public/captures/manifest.json`, made by
 * `scripts/captures/record.mjs`): real recordings of each product's live page
 * with fictional samples, per language. `captures.test.ts` guarantees every
 * visible product has them in every language.
 */
import manifest from "../../../public/captures/manifest.json";

export interface CaptureFile {
  src: string;
  bytes: number;
}

export interface CaptureStillEntry {
  avif: CaptureFile;
  jpg: CaptureFile;
  width: number;
  height: number;
}

export interface CaptureLoopEntry extends CaptureFile {
  width: number;
  height: number;
  seconds: number;
}

export interface ProductCaptures {
  loop: CaptureLoopEntry | null;
  poster: CaptureStillEntry | null;
  print: CaptureStillEntry | null;
  qr: CaptureStillEntry | null;
}

/** The Studio itself, for the home page's "How it works": a name being typed
 *  while the preview follows (a loop), and its phone preview (a still). */
export interface StudioCaptures {
  edit: Pick<ProductCaptures, "loop" | "poster"> | null;
  preview: CaptureStillEntry | null;
}

type Manifest = {
  products: Record<string, Record<string, ProductCaptures>>;
  studio: Record<string, StudioCaptures>;
};

const CAPTURES = (manifest as unknown as Manifest).products;
const STUDIO = (manifest as unknown as Manifest).studio;

/** The captures' language: the page's own, English for anything else. */
export function captureLocale(locale: string): "en" | "fr" | "ar" {
  return locale === "fr" || locale === "ar" ? locale : "en";
}

/** A product's captures in a language, or null for a product without any
 *  (only withdrawn ones, which never render). */
export function getProductCaptures(productId: string, locale: string): ProductCaptures | null {
  return CAPTURES[productId]?.[captureLocale(locale)] ?? null;
}

/** The Studio's captures in a language. */
export function getStudioCaptures(locale: string): StudioCaptures | null {
  return STUDIO?.[captureLocale(locale)] ?? null;
}

/** Absolute URLs of a product's stills, phone then print, for structured
 *  data and feeds. */
export function captureImageUrls(productId: string, locale: string, origin: string): string[] {
  const captures = getProductCaptures(productId, locale);
  return [captures?.poster?.jpg.src, captures?.print?.jpg.src]
    .filter((src): src is string => Boolean(src))
    .map((src) => `${origin}${src}`);
}
