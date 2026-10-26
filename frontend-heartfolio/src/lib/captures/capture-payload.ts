import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CAPTURE_LOCALES, CAPTURE_WORK_DIR, type CaptureProduct } from "./capture-mode";

/* Server-only file reading, kept out of `capture-mode.ts` so the proxy can
   import the lock without pulling in the filesystem. */

/** The sample's live payload, exactly as the backend's builder returned it
 *  (photo links rewritten to `/capture-assets/`), or null when the bundle has
 *  not been unpacked. */
export async function readCapturePayload(product: CaptureProduct, locale: string): Promise<unknown | null> {
  if (!(CAPTURE_LOCALES as readonly string[]).includes(locale)) return null;
  try {
    const text = await readFile(join(process.cwd(), CAPTURE_WORK_DIR, "payloads", `${product}.${locale}.json`), "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}
