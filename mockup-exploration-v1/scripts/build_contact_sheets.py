# -*- coding: utf-8 -*-
"""Per-language contact sheets for the minimalist mockup library.

One sheet per product per language (2 products x 6 languages = 12 sheets).
Each sheet tiles every design's `studio-white` mockup for that language, so a
reviewer can scan a whole product in one image per language. Reads the already
rendered mockups under heartfolio-mockup-library/<product>/<lang>/<design>/ and
writes heartfolio-mockup-library/contact-sheets/<product>-<lang>.png.
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import build_cinematic as bc

REPO = bc.LIB.parents[0]
OUTLIB = REPO / "heartfolio-mockup-library"
SHEETS = OUTLIB / "contact-sheets"
LANGS = ["en", "fr", "ar", "es", "ru", "zh-CN"]
PRODUCTS = ["love-story-timeline", "song-poster"]
PICK = "studio-white"          # representative variant on the sheet
COLS = 4
CELL = 540                     # thumbnail box (px)
PAD = 28
LABEL_H = 34
BG = (244, 243, 240)

def font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            pass
    return ImageFont.load_default()

def sheet(product, lang):
    base = OUTLIB / product / lang
    designs = sorted(d.name for d in base.iterdir() if d.is_dir())
    tiles = [(d, base / d / f"{PICK}.jpg") for d in designs]
    tiles = [(d, p) for d, p in tiles if p.exists()]
    if not tiles:
        return None
    rows = (len(tiles) + COLS - 1) // COLS
    cw = CELL + PAD
    ch = CELL + LABEL_H + PAD
    W = PAD + COLS * cw
    H = PAD + 70 + rows * ch
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((PAD, PAD), f"{product}  -  {lang}", fill=(28, 28, 30), font=font(38))
    d.text((PAD, PAD + 46), f"{len(tiles)} designs  -  variant: {PICK}", fill=(110, 110, 114), font=font(22))
    for i, (name, path) in enumerate(tiles):
        r, c = divmod(i, COLS)
        x = PAD + c * cw
        y = PAD + 70 + r * ch
        im = Image.open(path).convert("RGB")
        im.thumbnail((CELL, CELL), Image.LANCZOS)
        ox = x + (CELL - im.width) // 2
        oy = y + (CELL - im.height) // 2
        sheet.paste(im, (ox, oy))
        d.text((x, y + CELL + 6), name, fill=(60, 60, 64), font=font(22))
    SHEETS.mkdir(parents=True, exist_ok=True)
    out = SHEETS / f"{product}-{lang}.png"
    sheet.save(out)
    return out

def main():
    made = []
    for product in PRODUCTS:
        for lang in LANGS:
            out = sheet(product, lang)
            if out:
                made.append(out)
                print("sheet", out.relative_to(OUTLIB))
    print(f"\nDONE {len(made)} contact sheets")

if __name__ == "__main__":
    main()
