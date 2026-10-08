/**
 * Downloads the customer's paid deliverables from Django.
 *
 * WHY THIS EXISTS AT ALL, rather than a plain `<a href>`: the delivery
 * endpoints are authorized by the guest session cookie and return
 * `Cache-Control: private, no-store`. A bare link would not carry
 * credentials in every browser, and — worse — a 401/403/404 would render
 * as a broken page or an empty file instead of an error the UI can
 * explain. Fetching gives us the response to check before anything is
 * handed to the customer.
 *
 * NOTHING HERE GRANTS ACCESS. These are ordinary GETs; Django decides. A
 * customer who has not paid gets a 404 no matter what the browser does,
 * and there is no parameter, flag or local state in this module that can
 * change that. Editing `order.status` in devtools would let someone press
 * a button that then fails server-side — which is the intended property.
 */

import { isCompleteZip } from "@/lib/zip-integrity";

import { apiFetch, withToken } from "./client";
import { ApiError } from "./errors";

/** Fallback when the response carries no usable Content-Disposition. */
const DEFAULT_FILENAME = "heartfolio-download";

/**
 * Pulls the filename Django set. The backend already sanitises it
 * (path separators and control characters stripped) before it reaches
 * the header, so this only has to parse — but it re-strips separators
 * anyway rather than trusting a header to build a local filename.
 */
export function filenameFromDisposition(header: string | null, fallback = DEFAULT_FILENAME): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const raw = match?.[1]?.trim();
  if (!raw) return fallback;
  const cleaned = decodeURIComponent(raw).replace(/[\\/]/g, "").replace(/^\.+/, "");
  return cleaned || fallback;
}

/** Hands a blob to the browser as a file save, then releases the URL. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: revoking synchronously can cancel the
  // download in some browsers before it has started reading.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface DownloadResult {
  filename: string;
  bytes: number;
}

/**
 * The archive arrived, but not all of it.
 *
 * Pack zips are streamed, so the server's `200` and the first megabytes can
 * be on the wire long before the last file has rendered. If the server dies
 * mid-render the response just stops — `response.blob()` still resolves with
 * the partial bytes and nothing rejects, so without this check the customer
 * is handed a truncated file that the OS reports as an invalid folder.
 * Callers show a "try again" message; nothing has been saved.
 */
export class DownloadIncompleteError extends Error {
  constructor() {
    super("The downloaded archive was incomplete and was not saved.");
    this.name = "DownloadIncompleteError";
  }
}

/** Reads an archive response to the end and refuses to return it unless it
 *  is a complete zip. Every zip download goes through here. */
async function readCompleteZip(response: Response): Promise<Blob> {
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (cause) {
    // The connection dropped part-way through the body. The same situation
    // as a body that ends early, so it gets the same message — except an
    // abort the caller asked for, which is not a failure.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new DownloadIncompleteError();
  }
  if (!(await isCompleteZip(blob))) throw new DownloadIncompleteError();
  return blob;
}

/**
 * The whole purchased pack, as one archive.
 *
 * This is the primary action: Heartfolio sells packs, so a customer who
 * bought the Complete Pack gets one file rather than six clicks. Rendered
 * on demand server-side and never stored.
 */

export async function downloadOrderPack(
  orderId: string,
  signal?: AbortSignal,
  token?: string
): Promise<DownloadResult> {
  const response = await apiFetch<Response>(withToken(`/orders/${orderId}/download`, token), {
    method: "GET",
    parse: "response",
    signal,
  });

  const blob = await readCompleteZip(response);
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), "heartfolio-pack.zip");
  saveBlob(blob, filename);

  return { filename, bytes: blob.size };
}

/** §14's category zips — printable, wallpapers, live-cards, bonuses.
 *  `live-cards` carries BOTH the buyer's and the recipient's QR cards (there
 *  is no separate recipient zip). Kept as a literal union rather than a bare
 *  `string` so a typo in a call site (`"wallpaper"` instead of
 *  `"wallpapers"`) fails at compile time instead of as a 404 only
 *  discovered by clicking the button. */
export type DownloadCategory = "printable" | "wallpapers" | "live-cards" | "bonuses";

/**
 * One of §14's category zips, alongside (not replacing)
 * `downloadOrderPack` above — that one stays the "everything" option.
 *
 * Shares every property of the whole-pack download deliberately: same
 * session/token resolution via `withToken`, same blob-save mechanics,
 * same fallback filename shape. The two are one feature at two scopes,
 * not two features, so they share one implementation with the category
 * folded into the path.
 */
export async function downloadOrderCategory(
  orderId: string,
  category: DownloadCategory,
  signal?: AbortSignal,
  token?: string
): Promise<DownloadResult> {
  const response = await apiFetch<Response>(withToken(`/orders/${orderId}/download/${category}`, token), {
    method: "GET",
    parse: "response",
    signal,
  });

  const blob = await readCompleteZip(response);
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), `heartfolio-${category}.zip`);
  saveBlob(blob, filename);

  return { filename, bytes: blob.size };
}

/**
 * A single deliverable. Secondary to the pack download, and the only
 * route for a digital (`__live__`) entitlement, which resolves to a URL
 * rather than bytes and therefore cannot live inside an archive.
 */
export async function downloadEntitlement(
  entitlementId: string,
  signal?: AbortSignal,
  token?: string
): Promise<DownloadResult & { url?: string }> {
  const response = await apiFetch<Response>(withToken(`/entitlements/${entitlementId}/download`, token), {
    method: "GET",
    parse: "response",
    signal,
  });

  const contentType = response.headers.get("Content-Type") ?? "";

  // The digital deliverable comes back as JSON `{url}` rather than a
  // file — a hosted keepsake, not a download.
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { url?: string };
    if (payload.url) {
      window.open(payload.url, "_blank", "noopener,noreferrer");
      return { filename: "", bytes: 0, url: payload.url };
    }
    throw new ApiError({
      code: "renderer_not_available",
      message: "This keepsake is not ready yet.",
      status: response.status,
    });
  }

  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"));
  saveBlob(blob, filename);

  return { filename, bytes: blob.size };
}

/**
 * The raw bytes of a deliverable, rather than a browser download (§21i).
 *
 * `downloadEntitlement` exists to SAVE a file — it triggers the browser's
 * download and reports what happened. Compiling an AR target needs the
 * image in memory instead, so this shares the endpoint and the ownership
 * check while stopping short of the save.
 */
export async function fetchEntitlementBlob(
  entitlementId: string,
  token?: string,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await apiFetch<Response>(
    withToken(`/entitlements/${entitlementId}/download`, token),
    { method: "GET", parse: "response", signal }
  );
  return response.blob();
}
