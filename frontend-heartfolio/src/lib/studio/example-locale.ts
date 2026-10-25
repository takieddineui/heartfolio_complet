/**
 * Which language a product's example content (the sample story a new Studio
 * opens with) is written in. Until 25 Oct 2026 every Studio opened with
 * English examples on /fr and /ar too, and a customer who did not overwrite
 * one shipped English inside a French or Arabic gift.
 */
export type ExampleLocale = "en" | "fr" | "ar";

export function exampleLocale(locale: string | undefined): ExampleLocale {
  return locale === "fr" || locale === "ar" ? locale : "en";
}
