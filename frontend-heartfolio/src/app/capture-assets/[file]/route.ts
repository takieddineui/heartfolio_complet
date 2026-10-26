import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CAPTURE_ASSET_NAME, CAPTURE_WORK_DIR, captureModeEnabled } from "@/lib/captures/capture-mode";

/**
 * DEV ONLY: serves the sample photos the capture page's payloads point at
 * (`/capture-assets/<file>`), as the backend's upload pipeline stored them.
 * Same lock as the capture page (`captureModeEnabled`): a 404 on any server
 * that was not started for captures, and in every production build.
 */
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  m4a: "audio/mp4",
  mp4: "video/mp4",
};

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const type = TYPES[file.split(".").pop()?.toLowerCase() ?? ""];
  if (!captureModeEnabled() || !CAPTURE_ASSET_NAME.test(file) || !type) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const body = await readFile(join(process.cwd(), CAPTURE_WORK_DIR, "assets", file));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
