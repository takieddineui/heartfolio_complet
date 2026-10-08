import type { AssetManager } from "./extension-points";
import { uploadAsset, deleteAsset } from "@/lib/api/assets";

/**
 * The real Asset Manager — uploads to Django, which writes to Cloudflare R2
 * server-side. Replaces the object-URL mock that shipped with the Shell.
 *
 * NOTE ON WHEN THIS RUNS: this is NOT called when the customer picks a
 * photo. `POST /assets/` requires a guest identity, and identity requires
 * the email collected at checkout, so picking a photo only creates a local
 * preview and registers the file as pending (see `media-values.ts`). This
 * manager is driven by `uploadPendingMedia()` at checkout.
 *
 * The returned `url` is a short-lived presigned R2 link and must not be
 * persisted — `assetId` is the durable reference. The browser never holds
 * an R2 credential and never talks to R2 directly.
 */
export const assetManager: AssetManager = {
  async upload(file: File) {
    const asset = await uploadAsset(file);
    return {
      assetId: asset.assetId,
      url: asset.url,
      mimeType: asset.mimeType,
      filename: asset.filename ?? file.name,
    };
  },

  async remove(assetId: string) {
    await deleteAsset(assetId);
  },
};
