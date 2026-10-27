# -*- coding: utf-8 -*-
"""Validate the Live captures, write the CSV+JSON manifest, and build one
contact sheet per product. Run with the project venv's python."""
from __future__ import annotations
import csv, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageStat

LIB = Path(__file__).resolve().parents[1]
REPO = LIB.parents[0]
FONTS = REPO / "frontend-heartfolio/public/fonts"
F = ImageFont.truetype(str(FONTS / "inter-latin.woff2"), 20)
F_SM = ImageFont.truetype(str(FONTS / "inter-latin.woff2"), 15)
F_H = ImageFont.truetype(str(FONTS / "inter-latin.woff2"), 34)

PRODUCTS = ["love-story-timeline", "song-poster", "reasons-i-love-you", "graduation-keepsake"]
STATUS = {p: "integrated-functional" for p in PRODUCTS}
LOCALES = ["en", "fr", "ar"]
LIMIT = {
    "song-poster": "YouTube playback not exercisable offline (poster/pre-play captured)",
    "graduation-keepsake": "journey is an inner scroller; full-page = start screen, journey in states",
}
VIEWPORT = {"mobile": "390x844", "desktop": "1440x900"}

def describe_state(fn):
    s = fn.replace(".png", "")
    if s.endswith("full-page"): return s  # mobile-full-page / desktop-full-page
    return s

def is_blank(im):
    """True if the image is essentially one flat colour (blank/failed)."""
    ext = im.convert("RGB").getextrema()
    spread = max(hi - lo for lo, hi in ext)
    return spread < 8

def validate(path, state):
    try:
        with Image.open(path) as im:
            im.load(); w, h = im.size
            if w < 50 or h < 50: return False, f"{w}x{h}", "too small"
            if is_blank(im): return False, f"{w}x{h}", "blank/flat image"
            return True, f"{w}x{h}", ""
    except Exception as e:
        return False, "0x0", f"open failed: {e}"

def build():
    rows = []
    for product in PRODUCTS:
        for locale in LOCALES:
            d = LIB / product / "scenario-01" / locale
            if not d.exists(): continue
            for f in sorted(d.glob("*.png")):
                vp = "desktop" if f.name.startswith("desktop") else "mobile"
                ok, dims, note = validate(f, f.name)
                rows.append({
                    "product": product, "status": STATUS[product], "scenario": "scenario-01",
                    "scenario_description": "the product's committed fictional sample keepsake",
                    "language": locale, "viewport": vp, "viewport_css": VIEWPORT[vp],
                    "state": describe_state(f.name),
                    "file": str(f.relative_to(LIB)), "dimensions": dims,
                    "validated": "pass" if ok else "FAIL",
                    "validation_note": note,
                    "known_limitation": LIMIT.get(product, ""),
                })
    cols = ["product", "status", "scenario", "scenario_description", "language", "viewport",
            "viewport_css", "state", "file", "dimensions", "validated", "validation_note",
            "known_limitation"]
    (LIB / "manifest").mkdir(exist_ok=True)
    with open(LIB / "manifest" / "manifest.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)
    json.dump(rows, open(LIB / "manifest" / "manifest.json", "w"), ensure_ascii=False, indent=1)
    npass = sum(1 for r in rows if r["validated"] == "pass")
    print(f"manifest rows: {len(rows)}  pass: {npass}  fail: {len(rows)-npass}")
    for r in rows:
        if r["validated"] != "pass": print("  FAIL", r["file"], r["validation_note"])
    return rows

def contact_sheets(rows):
    CARD = (255, 253, 248); BG = (233, 232, 230); INK = (20, 27, 46); SUB = (95, 90, 82)
    for product in PRODUCTS:
        prows = [r for r in rows if r["product"] == product]
        # order states consistently
        order = ["mobile-full-page", "mobile-state-01", "mobile-state-02", "mobile-state-03",
                 "desktop-full-page"]
        def skey(r):
            for i, o in enumerate(order):
                if r["state"].startswith(o): return i
            return 99
        states = sorted({r["state"] for r in prows}, key=lambda s: next((i for i,o in enumerate(order) if s.startswith(o)), 99))
        cols = LOCALES; cw, ch, gap = 300, 560, 14
        rowsN = len(states)
        W = 40 + len(cols)*cw + (len(cols)-1)*gap + 40
        H = 150 + rowsN*(ch + 34) + 20
        canvas = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(canvas)
        d.text((40, 32), f"Heartfolio Live capture · {product}", font=F_H, fill=INK)
        sub = STATUS[product] + ("  ·  " + LIMIT[product] if product in LIMIT else "")
        d.text((40, 88), sub, font=F_SM, fill=SUB)
        # column headers
        for ci, loc in enumerate(cols):
            d.text((40 + ci*(cw+gap), 120), {"en":"English","fr":"Français","ar":"العربية (RTL)"}[loc], font=F, fill=INK)
        y = 150
        for ri, st in enumerate(states):
            for ci, loc in enumerate(cols):
                x = 40 + ci*(cw+gap); yy = y + ri*(ch+34)
                match = [r for r in prows if r["state"] == st and r["language"] == loc]
                cell = Image.new("RGB", (cw, ch), CARD)
                cd = ImageDraw.Draw(cell); cd.rectangle([0,0,cw-1,ch-1], outline=(220,214,200), width=1)
                if match:
                    im = Image.open(LIB / match[0]["file"]).convert("RGB")
                    # for very tall full-page, show the TOP portion at column width
                    scale = (cw-16) / im.width
                    thumb = im.resize((cw-16, int(im.height*scale)))
                    thumb = thumb.crop((0, 0, cw-16, min(ch-40, thumb.height)))
                    cell.paste(thumb, (8, 8))
                    tall = im.height > im.width*2.2
                    cd.text((8, ch-24), st + (f"  ({im.width}x{im.height}{' ↕' if tall else ''})"), font=F_SM, fill=SUB)
                else:
                    cd.text((8, ch//2), "— n/a —", font=F_SM, fill=(170,160,150))
                    cd.text((8, ch-24), st, font=F_SM, fill=SUB)
                canvas.paste(cell, (x, yy))
            y += 0
        out = LIB / "contact-sheets" / f"{product}.png"
        out.parent.mkdir(exist_ok=True)
        canvas.save(out); print("contact sheet", out.name, canvas.size)

if __name__ == "__main__":
    rows = build()
    contact_sheets(rows)
