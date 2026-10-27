# -*- coding: utf-8 -*-
"""Contact sheets (flat artwork only) + unified manifest for the V2
customer-artwork library (Love Story Timeline + Song Poster).

No mockups, frames, or marketing elements — the sheets show the genuine flat
customer artwork, labelled by style/theme, one sheet per product per language.
"""
from __future__ import annotations
import json, csv, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

LIB = Path(__file__).resolve().parents[1]
REPO = LIB.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from content_scenarios_lst import SCENARIOS as LST, LANGS
from content_songs import SONG_SCENARIOS as SONGS

FONTS = REPO / "frontend-heartfolio/public/fonts"
F_SANS = str(FONTS / "inter-latin.woff2"); F_NASKH = str(FONTS / "noto-naskh-arabic.woff2")
WQY = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
INK = (20, 27, 46); SUB = (90, 84, 74); CARD = (255, 253, 248); BG = (235, 231, 223)
LOCNAME = {"en": "English", "fr": "Français", "ar": "العربية (RTL)",
           "es": "Español", "ru": "Русский", "zh-CN": "简体中文"}

def font(size, cjk=False, ar=False):
    if cjk: return ImageFont.truetype(WQY, size, index=0)
    if ar: return ImageFont.truetype(F_NASKH, size)
    return ImageFont.truetype(F_SANS, size)

def lbl_font(text, size):
    if any('一' <= c <= '鿿' for c in text): return font(size, cjk=True)
    if any('؀' <= c <= 'ۿ' for c in text): return font(size, ar=True)
    return font(size)

def contain(im, bw, bh):
    w, h = im.size; s = min(bw/w, bh/h)
    return im.resize((max(1,int(w*s)), max(1,int(h*s))), Image.LANCZOS)

def cell(img, bw, bh, cap, sub=""):
    c = Image.new("RGB", (bw, bh), CARD)
    t = contain(img, bw-20, bh-64)
    c.paste(t, ((bw-t.width)//2, 10 + (bh-64-t.height)//2))
    d = ImageDraw.Draw(c); d.rectangle([0,0,bw-1,bh-1], outline=(222,214,198), width=1)
    d.text((10, bh-48), cap, font=lbl_font(cap, 20), fill=INK)
    if sub: d.text((10, bh-24), sub, font=font(15), fill=SUB)
    return c

def dims(p):
    with Image.open(p) as im: return im.size

def sheet(product, locale, items, title):
    cols = 3; bw, bh, gap = 560, 680, 16
    rows = (len(items)+cols-1)//cols
    Wc = 40 + cols*bw + (cols-1)*gap + 40
    Hc = 150 + rows*(bh+gap) + 20
    canvas = Image.new("RGB", (Wc, Hc), BG); d = ImageDraw.Draw(canvas)
    d.text((40, 34), title, font=font(38), fill=INK)
    d.text((40, 90), f"{LOCNAME[locale]}  ·  flat customer artwork (no frames, no marketing)",
           font=lbl_font(LOCNAME[locale], 24), fill=SUB)
    y = 150
    for i, (path, cap, sub) in enumerate(items):
        r, c = divmod(i, cols)
        canvas.paste(cell(Image.open(path).convert("RGB"), bw, bh, cap, sub),
                     (40 + c*(bw+gap), y + r*(bh+gap)))
    out = LIB / "contact-sheets" / f"{product}-{locale}.png"
    out.parent.mkdir(exist_ok=True)
    canvas.save(out); print("sheet", out.name, canvas.size)

def build_sheets():
    for loc in LANGS:
        items = []
        for s in LST:
            p = LIB / "love-story-timeline" / loc / f"{s['id']}-{s['style']}.png"
            items.append((p, s["style"], f"{s['id']} · {s['milestones']} milestones · {s['palette']}/{s['typography']}"))
        sheet("love-story-timeline", loc, items, "Heartfolio · Love Story Timeline — customer artwork")
    for loc in LANGS:
        items = []
        for s in SONGS:
            p = LIB / "song-poster" / loc / f"{s['id']}-{s['theme']}.png"
            items.append((p, s["theme"], f"{s['id']} · {s['genre']} · {s['mood']} · {s['decade']}"))
        sheet("song-poster", loc, items, "Heartfolio · Song Poster — customer artwork")

def build_manifest():
    rows = []
    for s in LST:
        for loc in LANGS:
            p = LIB / "love-story-timeline" / loc / f"{s['id']}-{s['style']}.png"
            w, h = dims(p)
            rows.append({"product": "love-story-timeline", "file": f"love-story-timeline/{loc}/{s['id']}-{s['style']}.png",
                         "language": loc, "style_or_theme": s["style"], "scenario": s["id"],
                         "story_type": s["storyType"], "milestones": s["milestones"],
                         "palette": s["palette"], "typography": s["typography"],
                         "genre": "", "mood": "", "decade": "", "context": "",
                         "dimensions": f"{w}x{h}", "format": "PNG",
                         "language_support": "live" if loc in ("en","fr","ar") else "sample-only",
                         "validated": True})
    for s in SONGS:
        for loc in LANGS:
            p = LIB / "song-poster" / loc / f"{s['id']}-{s['theme']}.png"
            w, h = dims(p)
            rows.append({"product": "song-poster", "file": f"song-poster/{loc}/{s['id']}-{s['theme']}.png",
                         "language": loc, "style_or_theme": s["theme"], "scenario": s["id"],
                         "story_type": "", "milestones": "",
                         "palette": s.get("sleevePalette",""), "typography": "",
                         "genre": s["genre"], "mood": s["mood"], "decade": s["decade"], "context": s["context"],
                         "dimensions": f"{w}x{h}", "format": "PNG",
                         "language_support": "live" if loc in ("en","fr","ar") else "sample-only",
                         "validated": True})
    cols = ["product","file","language","style_or_theme","scenario","story_type","milestones",
            "palette","typography","genre","mood","decade","context","dimensions","format",
            "language_support","validated"]
    (LIB/"manifest").mkdir(exist_ok=True)
    with open(LIB/"manifest"/"manifest.csv","w",newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
    json.dump(rows, open(LIB/"manifest"/"manifest.json","w"), ensure_ascii=False, indent=1)
    print("manifest rows:", len(rows))

if __name__ == "__main__":
    build_sheets()
    build_manifest()
