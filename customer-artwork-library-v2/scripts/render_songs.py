# -*- coding: utf-8 -*-
"""Render the Song Poster customer-artwork (8 themes x 6 languages) with the
REAL Song Poster renderer.

Localization for es/ru/zh-CN is SAMPLE-ONLY and touches no production code:
  - Cyrillic (ru) is covered by the renderer's DejaVu faces.
  - CJK (zh-CN) is drawn via the renderer's own MixedScriptFont mechanism with
    a WenQuanYi Zen Hei fallback over the CJK unicode ranges.
Song Poster has no dates/durations, so the only localised content is the
customer's own text (track / artist / dedication), authored per language.

Output: song-poster/<lang>/<scenario>-<theme>.png  (authentic deliverable).
"""
from __future__ import annotations
import os, sys, json, functools, io
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIB = HERE.parent
REPO = LIB.parent
BACKEND = REPO / "backend"
PHOTOS = BACKEND / "apps/delivery/marketing_samples/photos"
WQY = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
TARGET = "print-classic-edged"

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
os.environ.setdefault("DJANGO_SECRET_KEY", "v2-song-render")
os.environ.setdefault("DATABASE_URL", "postgres://u:p@localhost:5432/none")
os.environ.setdefault("ASSET_STORAGE_BACKEND", "mock")
os.environ.setdefault("ALLOWED_ASSET_MIME_TYPES", "image/jpeg,image/png,image/webp")
sys.path.insert(0, str(BACKEND)); sys.path.insert(0, str(HERE))

import django; django.setup()
from PIL import Image, ImageFont
from apps.delivery.mixed_script import MixedScriptFont

_PHOTO_CACHE = {}
def fake_get_asset_bytes(customer, asset_id):
    if asset_id not in _PHOTO_CACHE:
        _PHOTO_CACHE[asset_id] = (PHOTOS / asset_id).read_bytes()
    return _PHOTO_CACHE[asset_id], "image/jpeg"

import apps.assets.services as asset_services
asset_services.get_asset_bytes_for_customer = fake_get_asset_bytes
from apps.delivery.product_renderers.song_poster import png_renderer as P
P.get_asset_bytes_for_customer = fake_get_asset_bytes
from apps.delivery.product_renderers.song_poster.data import validate_and_normalize, THEMES
from apps.common.youtube import extract_video_id

ORIG_FONT = P._font

CJK_RANGES = [(0x3000, 0x303F), (0x3400, 0x9FFF), (0xF900, 0xFAFF), (0xFF00, 0xFFEF)]
@functools.lru_cache(maxsize=256)
def cjk_font(name, size_at_design_scale, scale, *, weight=400):
    size = max(8, round(size_at_design_scale * scale))
    second = ImageFont.truetype(WQY, size=size, index=0)
    return MixedScriptFont(str(P._FONT_DIR / name), size, second=second, second_range=CJK_RANGES)

from content_songs import SONG_SCENARIOS, LANGS

class Cust:
    id = "v2-song"

# a syntactically valid dummy YouTube URL per scenario (the print never fetches
# it; only checkout's oEmbed check would, which we do not run)
DUMMY_IDS = ["aBcDeFgHiJ0", "KlMnOpQrStU", "vWxYz012345", "A1b2C3d4E5f",
             "G6h7I8j9K0l", "MnOpQrStUvW", "xYz0123456A", "bCdEfGhIjK1"]

def build_values(scen, lang, idx):
    c = scen["lang"][lang]
    ded = c.get("dedication", "")
    # sleeve draws the dedication unshaped (plain DejaVu) around the disc:
    # blank it for ar/zh-CN on that theme only, to avoid unjoined/tofu text.
    if scen["theme"] == "sleeve" and lang in ("ar", "zh-CN"):
        ded = ""
    vid = DUMMY_IDS[idx % len(DUMMY_IDS)]
    url = f"https://www.youtube.com/watch?v={vid}"
    assert extract_video_id(url) == vid
    return {
        "track": c["track"], "artist": c["artist"], "dedication": ded,
        "photo": {"assetId": scen["photo"]},
        "youtubeUrl": url, "youtubeVideoId": vid,
    }

def main():
    manifest, errors = [], []
    for idx, scen in enumerate(SONG_SCENARIOS):
        ts = {"theme": scen["theme"], "scale": 100}
        if "sleevePalette" in scen:
            ts["sleevePalette"] = scen["sleevePalette"]
        for lang in LANGS:
            values = build_values(scen, lang, idx)
            try:
                song = validate_and_normalize(values, ts)
            except Exception as e:
                errors.append((scen["id"], lang, str(e)[:300]))
                print("VALIDATE FAIL", scen["id"], lang, str(e)[:160]); continue
            P._font = cjk_font if lang == "zh-CN" else ORIG_FONT
            try:
                png = P.render_png(song, target_id=TARGET, customer=Cust())
            except Exception as e:
                errors.append((scen["id"], lang, "RENDER: " + str(e)[:300]))
                print("RENDER FAIL", scen["id"], lang, str(e)[:160]); continue
            name = f"{scen['id']}-{scen['theme']}.png"
            outdir = LIB / "song-poster" / lang
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / name).write_bytes(png)
            w, h = Image.open(io.BytesIO(png)).size
            manifest.append({
                "library": "song-poster", "file": f"song-poster/{lang}/{name}",
                "language": lang, "theme": scen["theme"], "scenario": scen["id"],
                "genre": scen["genre"], "mood": scen["mood"], "decade": scen["decade"],
                "context": scen["context"], "sleeve_palette": scen.get("sleevePalette", ""),
                "width": w, "height": h, "format": "PNG", "target": TARGET, "validated": True,
            })
            print("OK", lang, scen["id"], scen["theme"], f"{w}x{h}", len(png))
    (LIB / "manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(LIB / "manifest" / "song_manifest.json", "w"),
              ensure_ascii=False, indent=1)
    print(f"\nDONE song artworks: {len(manifest)}  errors: {len(errors)}")
    for e in errors:
        print("  ERR", e)

if __name__ == "__main__":
    main()
