import { resolveModuleText } from "@/lib/studio/i18n";
import { giftOrDefault, type GiftId } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";
import type { ReasonsValues } from "@/lib/studio/product-modules/reasons-i-love-you/initial-state";
import { REASONS_LIMITS } from "@/lib/studio/product-modules/reasons-i-love-you/limits";
import { reasonsMessages } from "@/lib/studio/product-modules/reasons-i-love-you/messages";
import type { LocaleCode, ThemeSelections } from "@/types/studio";

/**
 * WHAT THE EXPERIENCE DRAWS, in one shape for both of its homes: the Studio's
 * live preview (built from the customer's form values, below) and the
 * purchased `/live/<id>` page (built by the backend's
 * `_build_reasons_live_payload`, which returns exactly this shape with fresh,
 * ownership-checked photo URLs).
 */
export interface ExperienceReason {
  text: string;
  memory: string;
  photo: { url: string } | null;
}

export interface ReasonsExperienceData {
  gift: GiftId;
  toName: string;
  fromName: string;
  /** As written; empty means the localized default. See `resolveTitle`. */
  title: string;
  reasons: ExperienceReason[];
  finaleTeaser: string;
  finaleLine: string;
  signature: string;
  letter: { greeting: string; paragraphs: string[]; signoff: string } | null;
  music: boolean;
  share: boolean;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The Studio's flat form values, as the experience draws them. A photo's
 * `url` here is the preview's own (a local object URL or a presigned one). */
export function experienceFromStudio(values: ReasonsValues, themeSelections: ThemeSelections): ReasonsExperienceData {
  const reasons = (Array.isArray(values.reasons) ? values.reasons : [])
    .filter((reason) => text(reason?.text))
    .slice(0, REASONS_LIMITS.maxReasons)
    .map((reason) => ({
      text: text(reason.text),
      memory: text(reason.memory),
      photo: reason.photo?.url ? { url: reason.photo.url } : null,
    }));
  const paragraphs = (Array.isArray(values.letterParagraphs) ? values.letterParagraphs : [])
    .map((paragraph) => text(paragraph?.text))
    .filter(Boolean);

  return {
    gift: giftOrDefault(themeSelections.gift),
    toName: text(values.toName),
    fromName: text(values.fromName),
    title: text(values.title),
    reasons,
    finaleTeaser: text(values.finaleTeaser),
    finaleLine: text(values.finaleLine),
    signature: text(values.signature),
    letter: values.letterEnabled ? { greeting: text(values.letterGreeting), paragraphs, signoff: text(values.letterSignoff) } : null,
    music: values.music !== false,
    share: values.showShare !== false,
  };
}

export function localeOf(locale: string): LocaleCode {
  return (locale in reasonsMessages ? locale : "en") as LocaleCode;
}

/** The experience's own copy, from the module's dictionary (not next-intl),
 * so the same strings render in the Studio and on the live page. */
export function translatorFor(locale: string) {
  return (key: string, params?: Record<string, string | number>) => resolveModuleText(key, localeOf(locale), reasonsMessages, params);
}

/** Numbers in the reader's own digits. Arabic is set EXPLICITLY to
 * Arabic-Indic (٣), matching the site's existing Arabic copy (the print size
 * labels, ٨×١٠): left to the engine, `ar` gives Latin digits in some
 * browsers and Arabic-Indic in others, so the same gift would vary by device. */
export function formatCount(value: number, locale: string): string {
  const code = localeOf(locale);
  return new Intl.NumberFormat(code, code === "ar" ? { numberingSystem: "arab" } : undefined).format(value);
}

/**
 * The tag's title. A title the sender wrote is used as written, with
 * `{count}` filled in. An empty one becomes the localized default, chosen by
 * plural category, because "{count} reasons" is wrong in Arabic for 1, 2 and
 * 3-10 alike and in French for 1. A category a language does not list falls
 * back to that SAME language's `other`, never to English.
 */
export function resolveTitle(data: Pick<ReasonsExperienceData, "title" | "reasons">, locale: string): string {
  const code = localeOf(locale);
  const count = data.reasons.length;
  const shown = formatCount(count, code);
  if (data.title) return data.title.split("{count}").join(shown);
  const category = new Intl.PluralRules(code).select(count);
  const dictionary = reasonsMessages[code] ?? {};
  const key = `experience.title.${category}` in dictionary ? `experience.title.${category}` : "experience.title.other";
  return (dictionary[key] ?? "").split("{count}").join(shown);
}

export function resolveSignature(data: Pick<ReasonsExperienceData, "signature" | "fromName">): string {
  return data.signature || data.fromName;
}
