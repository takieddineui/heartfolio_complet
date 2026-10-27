"""Render every REAL print — all 6 Love Story Timeline layouts and all 8
Song Poster themes, in en/fr/ar — by driving the project's own Pillow
renderers directly, with sample content and the committed marketing photos.

No DB is touched: photo resolution is monkeypatched to read the local
marketing_samples/photos, and no model is queried.
"""
import os, io, json, sys
from pathlib import Path

BACKEND = Path("/home/user/heartfolio_complet/backend")
PHOTOS = BACKEND / "apps/delivery/marketing_samples/photos"
SAMPLES = json.load(open(BACKEND / "apps/delivery/marketing_samples/samples.json"))
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
os.environ.setdefault("DJANGO_SECRET_KEY", "marketing-render-only")
os.environ.setdefault("DATABASE_URL", "postgres://u:p@localhost:5432/none")
os.environ.setdefault("ASSET_STORAGE_BACKEND", "mock")
os.environ.setdefault("ALLOWED_ASSET_MIME_TYPES", "image/jpeg,image/png,image/webp")
sys.path.insert(0, str(BACKEND))

import django
django.setup()

# --- monkeypatch photo resolution to read local sample photos ---
PHOTO_CACHE = {}
def fake_get_asset_bytes(customer, asset_id):
    # asset_id is the sample photo filename
    if asset_id not in PHOTO_CACHE:
        PHOTO_CACHE[asset_id] = (PHOTOS / asset_id).read_bytes()
    return PHOTO_CACHE[asset_id], "image/jpeg"

import apps.assets.services as asset_services
asset_services.get_asset_bytes_for_customer = fake_get_asset_bytes
from apps.delivery.product_renderers.love_story_timeline import png_renderer as lst_png
lst_png.get_asset_bytes_for_customer = fake_get_asset_bytes
from apps.delivery.product_renderers.song_poster import png_renderer as sp_png
sp_png.get_asset_bytes_for_customer = fake_get_asset_bytes

from apps.delivery.product_renderers.love_story_timeline.data import validate_and_normalize as lst_validate, LAYOUTS
from apps.delivery.product_renderers.song_poster.data import validate_and_normalize as sp_validate, THEMES

PRINT_TARGET = "print-classic-edged"
LOCALES = ("en", "fr", "ar")

class Cust:  # a stand-in; only identity is used, photos come from the patch
    id = "marketing"

def deref_photos(values):
    """Turn {'$photo': 'name.jpg'} into {'assetId': 'name.jpg'}."""
    import copy
    v = copy.deepcopy(values)
    for ev in v.get("events", []):
        p = ev.get("photo")
        if isinstance(p, dict) and "$photo" in p:
            ev["photo"] = {"assetId": p["$photo"]}
    p = v.get("photo")
    if isinstance(p, dict) and "$photo" in p:
        v["photo"] = {"assetId": p["$photo"]}
    return v

manifest = []

# ---- Love Story Timeline: all 6 layouts ----
for locale in LOCALES:
    sample = SAMPLES["love-story-timeline"][locale]
    values = deref_photos(sample["values"])
    for layout in LAYOUTS:
        ts = dict(sample["themeSelections"]); ts["layout"] = layout
        timeline = lst_validate(values, ts)
        png = lst_png.render_png(timeline, target_id=PRINT_TARGET, customer=Cust(), locale=locale)
        name = f"lst_{layout}_{locale}.png"
        (OUT / name).write_bytes(png)
        print("LST", locale, layout, len(png))
        manifest.append({"product": "love-story-timeline", "variant": layout, "locale": locale, "file": name})

# ---- Song Poster: all 8 themes ----
for locale in LOCALES:
    sample = SAMPLES["song-poster"][locale]
    values = deref_photos(sample["values"])
    for theme in THEMES:
        ts = dict(sample["themeSelections"]); ts["theme"] = theme
        song = sp_validate(values, ts)
        png = sp_png.render_png(song, target_id=PRINT_TARGET, customer=Cust())
        name = f"song_{theme}_{locale}.png"
        (OUT / name).write_bytes(png)
        print("SONG", locale, theme, len(png))
        manifest.append({"product": "song-poster", "variant": theme, "locale": locale, "file": name})

json.dump(manifest, open(OUT / "prints_manifest.json", "w"), indent=2)
print("DONE", len(manifest), "prints")
