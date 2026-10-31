"""
Output shape matches the existing frontend `AssetManager.upload` return
value (`{assetId, url, mimeType, filename}` — see
src/lib/studio/asset-manager.ts) plus `id`, kept alongside `assetId` for
consistency with every other Phase 3.4 serializer's REST resource
identifier convention. Both fields carry the same UUID string.

`url` is computed fresh per-request from `generate_asset_access_url`
(never a model field) — see apps/assets/services.py. `previewUrl` is what
the Studio shows: a photo's largest web copy (`asset_preview_url`), else
the same as `url`.
"""

from rest_framework import serializers


class AssetSerializer(serializers.Serializer):
    id = serializers.CharField()
    assetId = serializers.CharField(source="id")
    url = serializers.CharField()
    previewUrl = serializers.CharField()
    mimeType = serializers.CharField()
    filename = serializers.CharField(allow_null=True)

    @classmethod
    def from_asset(cls, asset, *, url: str, preview_url: str | None = None) -> "AssetSerializer":
        return cls(
            {
                "id": str(asset.id),
                "url": url,
                "previewUrl": preview_url or url,
                "mimeType": asset.mime_type,
                "filename": asset.original_filename,
            }
        )
