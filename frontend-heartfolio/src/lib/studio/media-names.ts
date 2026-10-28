import { resolveShellValidationText } from "@/lib/studio/i18n";

/**
 * What the Studio calls a recording, video or file in its lists: the
 * browser's own filename while this tab still has it, else "Recording 2",
 * "Video 1"... A saved project keeps no filename (27 Oct 2026), so a
 * reopened draft shows these instead. `index` is the item's place in its
 * list, from 0.
 */
export function mediaDisplayName(media: { filename?: string; mimeType?: string }, index: number, locale: string): string {
  if (media.filename) return media.filename;
  const kind = media.mimeType?.startsWith("audio/") ? "audio" : media.mimeType?.startsWith("video/") ? "video" : "file";
  return resolveShellValidationText(`media.name.${kind}`, locale, { n: index + 1 });
}
