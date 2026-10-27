# -*- coding: utf-8 -*-
"""Render the V2 customer-artwork library with the REAL Love Story Timeline
print renderer.

For en/fr/ar the renderer runs exactly as production does. For es/ru/zh-CN
(not live-supported languages) this driver adds SAMPLE-ONLY shims, touching no
production file:
  - Cyrillic (ru) is already covered by the renderer's DejaVu faces.
  - CJK (zh-CN) is drawn via the renderer's own MixedScriptFont mechanism with
    a WenQuanYi Zen Hei fallback over the CJK unicode ranges.
  - milestone dates and the "days together" duration line are localised for
    es/ru/zh (the live product localises these for en/fr/ar only).

Output: customer-artwork/<lang>/<scenario>-<style>.png  (no marketing text,
no frames — the authentic customer deliverable), plus a manifest.
"""
from __future__ import annotations
import os, sys, json, functools
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
OUTROOT = Path(__file__).resolve().parents[1]
PHOTOS = BACKEND / "apps/delivery/marketing_samples/photos"
WQY = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
TARGET = "print-classic-edged"

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
os.environ.setdefault("DJANGO_SECRET_KEY", "v2-artwork-render")
os.environ.setdefault("DATABASE_URL", "postgres://u:p@localhost:5432/none")
os.environ.setdefault("ASSET_STORAGE_BACKEND", "mock")
os.environ.setdefault("ALLOWED_ASSET_MIME_TYPES", "image/jpeg,image/png,image/webp")
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import django
django.setup()

from PIL import Image, ImageFont
import io
from datetime import date as date_cls

# ---- photo stub (no DB) ----
_PHOTO_CACHE = {}
def fake_get_asset_bytes(customer, asset_id):
    if asset_id not in _PHOTO_CACHE:
        _PHOTO_CACHE[asset_id] = (PHOTOS / asset_id).read_bytes()
    return _PHOTO_CACHE[asset_id], "image/jpeg"

import apps.assets.services as asset_services
asset_services.get_asset_bytes_for_customer = fake_get_asset_bytes
from apps.delivery.product_renderers.love_story_timeline import png_renderer as P
P.get_asset_bytes_for_customer = fake_get_asset_bytes
from apps.delivery.mixed_script import MixedScriptFont
from apps.delivery.product_renderers.love_story_timeline import layout as LAYOUT
from apps.delivery.product_renderers.love_story_timeline import data as DATA
from apps.delivery import date_formatting as DF

ORIG_FONT = P._font  # lru_cached production font loader

# ---- sample-only date + duration localisation (es/ru/zh) ----
SHORT_MONTHS_EXTRA = {
    "es": ("ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."),
    "ru": ("янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."),
}
GROUP_SEP = {"en": ",", "fr": " ", "ar": ",", "es": ".", "ru": " ", "zh-CN": ",", "zh": ","}

_orig_short_date = LAYOUT.format_short_date
def localized_short_date(d, locale="en"):
    lang = (locale or "en")
    if lang.startswith("zh"):
        return f"{d.year}年{d.month}月{d.day}日"
    if lang in SHORT_MONTHS_EXTRA:
        return f"{d.day} {SHORT_MONTHS_EXTRA[lang][d.month-1]} {d.year}"
    return _orig_short_date(d, locale)
LAYOUT.format_short_date = localized_short_date

_orig_count = DF.format_count
def localized_count(n, locale="en"):
    sep = GROUP_SEP.get(locale, GROUP_SEP.get((locale or "en").split("-")[0], ","))
    return f"{n:,}".replace(",", " ") if sep == " " else f"{n:,}".replace(",", sep)
DF.format_count = localized_count

# extend duration phrases for couple & parents in es/ru/zh (sample-only)
DATA._DURATION_PHRASES["couple"].update({
    "es": "{days} días juntos", "ru": "{days} дней вместе", "zh-CN": "在一起 {days} 天",
})
DATA._DURATION_PHRASES["parents"].update({
    "es": "{days} días lado a lado", "ru": "{days} дней рядом", "zh-CN": "相伴 {days} 天",
})
# duration_phrase does phrases.get(locale, en); add zh-CN keys already; also map bare 'zh'
for st in ("couple", "parents"):
    DATA._DURATION_PHRASES[st]["zh"] = DATA._DURATION_PHRASES[st]["zh-CN"]

# ---- CJK font fallback (zh-CN), via the renderer's own MixedScriptFont ----
CJK_RANGES = [(0x3000, 0x303F), (0x3400, 0x9FFF), (0xF900, 0xFAFF), (0xFF00, 0xFFEF)]
@functools.lru_cache(maxsize=256)
def cjk_font(path_name, size):
    base = str(P.FONT_DIR / path_name)
    second = ImageFont.truetype(WQY, size=size, index=0)
    return MixedScriptFont(base, size, second=second, second_range=CJK_RANGES)

from content_scenarios_lst import SCENARIOS, LANGS
from apps.delivery.product_renderers.love_story_timeline.data import validate_and_normalize

class Cust:
    id = "v2"

def build_values(scen, lang):
    c = scen["lang"][lang]
    events = []
    for i in range(scen["milestones"]):
        events.append({
            "date": scen["dates"][i],
            "title": c["titles"][i],
            "description": c["descs"][i],
            "location": c["locations"][i],
            "photo": {"assetId": scen["photos"][i]},
        })
    return {
        "storyType": scen["storyType"],
        "people": [{"name": n} for n in c["people"]],
        "posterTitle": c["posterTitle"],
        "subtitle": c.get("subtitle", ""),
        "dedication": c["dedication"],
        "endingText": c["endingText"],
        "backgroundMusic": "none",
        "showDuration": True,
        "autoSort": True,
        "events": events,
    }

def main():
    manifest = []
    errors = []
    for scen in SCENARIOS:
        ts = {"palette": scen["palette"], "typography": scen["typography"],
              "layout": scen["style"], "scale": scen["scale"]}
        for lang in LANGS:
            values = build_values(scen, lang)
            try:
                timeline = validate_and_normalize(values, ts)
            except Exception as e:
                errors.append((scen["id"], lang, str(e)[:300]))
                print("VALIDATE FAIL", scen["id"], lang, str(e)[:200]); continue
            # font pipeline: CJK fallback only for zh-CN
            P._font = cjk_font if lang == "zh-CN" else ORIG_FONT
            try:
                png = P.render_png(timeline, target_id=TARGET, customer=Cust(), locale=lang)
            except Exception as e:
                errors.append((scen["id"], lang, "RENDER: " + str(e)[:300]))
                print("RENDER FAIL", scen["id"], lang, str(e)[:200]); continue
            name = f"{scen['id']}-{scen['style']}.png"
            outdir = OUTROOT / "love-story-timeline" / lang
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / name).write_bytes(png)
            w, h = Image.open(io.BytesIO(png)).size
            manifest.append({
                "library": "love-story-timeline", "file": f"love-story-timeline/{lang}/{name}",
                "language": lang, "style": scen["style"], "palette": scen["palette"],
                "typography": scen["typography"], "scenario": scen["id"],
                "storyType": scen["storyType"], "milestones": scen["milestones"],
                "width": w, "height": h, "format": "PNG", "target": TARGET,
                "validated": True,
            })
            print("OK", lang, scen["id"], scen["style"], f"{w}x{h}", len(png))
    (OUTROOT / "manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(OUTROOT / "manifest" / "artwork_manifest.json", "w"),
              ensure_ascii=False, indent=1)
    print(f"\nDONE artworks: {len(manifest)}  errors: {len(errors)}")
    for e in errors:
        print("  ERR", e)

if __name__ == "__main__":
    main()
