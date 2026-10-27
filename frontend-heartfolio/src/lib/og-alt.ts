import { createTranslator } from "next-intl";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/**
 * A share image's alt text in the page's language (27 Oct 2026).
 *
 * `generateImageMetadata` runs at BUILD time too (Next derives the image's
 * static params from it), where `getTranslations` reaches for request headers
 * and fails the build. This reads the same message files without a request.
 */
const MESSAGES = { en, fr, ar } as const;

export function ogAltTranslator(locale: string, namespace: string): (key: string, values?: Record<string, string>) => string {
  const known = locale === "fr" || locale === "ar" ? locale : "en";
  // Namespaces here are built at run time (`Products.<key>`), which the
  // translator's message-key types cannot follow.
  const t = createTranslator({ locale: known, messages: MESSAGES[known], namespace: namespace as never }) as unknown as (
    key: string,
    values?: Record<string, string>
  ) => string;
  return (key, values) => t(key, values);
}
