"""Customers' filenames are not kept (owner's decision, 27 Oct 2026).

The Studio's media values (`{url, mimeType, filename, assetId}`) used to be
saved with the name of the file the buyer picked ("Sarah & me - Paris
2019.jpg", a phone's capture timestamp), and a paid order's project keeps
its data for good. Nothing on the server uses that name: every renderer and
live page reads `assetId` only (see each product's `data.py`).

`strip_media_filenames` removes `filename` from every media value, matched
by shape as the Studio matches them (`isMediaValue` in `media-values.ts`: a
`url` and a `mimeType`, both strings), so it needs no knowledge of any
product's fields. Projects are stripped on every save
(`apps.projects.services`); older projects by `move_assets_to_new_layout`.
"""

from __future__ import annotations


def is_media_value(node) -> bool:
    return isinstance(node, dict) and isinstance(node.get("url"), str) and isinstance(node.get("mimeType"), str)


def strip_media_filenames(node):
    """Returns `(stripped copy, number of filenames removed)`. Anything that
    is not a media value is copied unchanged, key order included."""
    if isinstance(node, list):
        removed = 0
        items = []
        for item in node:
            stripped, count = strip_media_filenames(item)
            items.append(stripped)
            removed += count
        return items, removed
    if isinstance(node, dict):
        removed = 0
        result = {}
        media = is_media_value(node)
        for key, value in node.items():
            if media and key == "filename":
                removed += 1
                continue
            stripped, count = strip_media_filenames(value)
            result[key] = stripped
            removed += count
        return result, removed
    return node, 0
