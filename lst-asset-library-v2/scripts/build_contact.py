# -*- coding: utf-8 -*-
"""Contact sheets + unified manifest for the V2 library.

- customer-artwork: one sheet per language (all six styles).
- marketing-mockups: one comparison sheet (6 heroes x 3 directions) so the
  three presentation directions can be judged on comparable artwork.
- manifest/manifest.csv + manifest.json: every asset with full metadata.
"""
from __future__ import annotations
import json, csv, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from content_scenarios import SCENARIOS, LANGS, MOCKUP_HEROES

FONTS = ROOT.parent / "frontend-heartfolio/public/fonts"
F_SANS = str(FONTS / "inter-latin.woff2")
F_NASKH = str(FONTS / "noto-naskh-arabic.woff2")
WQY = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
INK = (20, 27, 46); SUB = (90, 84, 74); CARD = (255, 253, 248); BG = (235, 231, 223)
LOCNAME = {"en": "English", "fr": "Français", "ar": "العربية (RTL)",
           "es": "Español", "ru": "Русский", "zh-CN": "简体中文"}

def font(size, cjk=False, ar=False):
    if cjk: return ImageFont.truetype(WQY, size, index=0)
    if ar: return ImageFont.truetype(F_NASKH, size)
    return ImageFont.truetype(F_SANS, size)

def label_font(text, size):
    # pick a face that covers the text
    if any('一' <= c <= '鿿' for c in text): return font(size, cjk=True)
    if any('؀' <= c <= 'ۿ' for c in text): return font(size, ar=True)
    return font(size)

def contain(im, bw, bh):
    w, h = im.size; s = min(bw/w, bh/h)
    return im.resize((max(1,int(w*s)), max(1,int(h*s))), Image.LANCZOS)

def cell(img, bw, bh, caption, sub=""):
    c = Image.new("RGB", (bw, bh), CARD)
    t = contain(img, bw-20, bh-64)
    c.paste(t, ((bw-t.width)//2, 10 + (bh-64-t.height)//2))
    d = ImageDraw.Draw(c)
    d.rectangle([0,0,bw-1,bh-1], outline=(222,214,198), width=1)
    f = label_font(caption, 20)
    d.text((10, bh-48), caption, font=f, fill=INK)
    if sub:
        d.text((10, bh-24), sub, font=font(15), fill=SUB)
    return c

def header(canvas, title, subtitle, locale=None):
    d = ImageDraw.Draw(canvas)
    d.text((40, 34), title, font=font(40), fill=INK)
    sf = label_font(subtitle, 24)
    d.text((40, 90), subtitle, font=sf, fill=SUB)

# ---- per-language artwork sheets ----
def artwork_sheet(locale):
    cols, bw, bh, gap = 3, 560, 680, 16
    scen = SCENARIOS
    rows = (len(scen)+cols-1)//cols
    Wc = 40 + cols*bw + (cols-1)*gap + 40
    Hc = 150 + rows*(bh+gap) + 20
    canvas = Image.new("RGB", (Wc, Hc), BG)
    header(canvas, "Heartfolio · Love Story Timeline — V2 customer artwork",
           f"{LOCNAME[locale]}  ·  the six current styles  ·  authentic customer deliverable (no marketing, no frames)")
    y = 150
    for i, s in enumerate(scen):
        r, c = divmod(i, cols)
        x = 40 + c*(bw+gap); yy = y + r*(bh+gap)
        p = ROOT / "customer-artwork" / locale / f"{s['id']}-{s['style']}.png"
        cap = s["style"]
        sub = f"{s['scenario_label'] if 'scenario_label' in s else s['id']} · {s['milestones']} milestones · {s['palette']}/{s['typography']}"
        canvas.paste(cell(Image.open(p).convert("RGB"), bw, bh, cap, sub), (x, yy))
    out = ROOT / "contact-sheets" / f"artwork-{locale}.png"
    canvas.save(out); print("sheet", out.name, canvas.size)

# ---- marketing directions comparison ----
def mockup_sheet():
    dirs = ["luxury-editorial", "modern-minimalist", "warm-romantic"]
    bw, bh, gap = 440, 660, 16
    heroes = MOCKUP_HEROES
    byid = {s["id"]: s for s in SCENARIOS}
    Wc = 60 + 3*bw + 2*gap + 40
    Hc = 160 + len(heroes)*(bh+gap) + 20
    canvas = Image.new("RGB", (Wc, Hc), BG)
    header(canvas, "Heartfolio · LST — V2 marketing mockups",
           "Three presentation directions compared on comparable artwork (rows = hero · columns = direction)")
    d = ImageDraw.Draw(canvas)
    for j, dr in enumerate(dirs):
        d.text((60 + j*(bw+gap), 128), dr, font=font(24), fill=INK)
    y = 160
    for i, (sid, lang) in enumerate(heroes):
        s = byid[sid]
        for j, dr in enumerate(dirs):
            p = ROOT / "marketing-mockups" / dr / f"{sid}-{lang}-{s['style']}.jpg"
            x = 60 + j*(bw+gap); yy = y + i*(bh+gap)
            cap = f"{sid} · {lang}"
            canvas.paste(cell(Image.open(p).convert("RGB"), bw, bh, cap, s["style"]), (x, yy))
    out = ROOT / "contact-sheets" / "mockups-directions.png"
    canvas.save(out); print("sheet", out.name, canvas.size)

# ---- unified manifest ----
def unified_manifest():
    art = json.load(open(ROOT/"manifest"/"artwork_manifest.json"))
    mock = json.load(open(ROOT/"manifest"/"mockup_manifest.json"))
    rows = []
    for a in art:
        rows.append({
            "file": a["file"], "library": "customer-artwork", "language": a["language"],
            "style": a["style"], "scenario": a["scenario"], "story_type": a["storyType"],
            "milestones": a["milestones"], "palette": a["palette"], "typography": a["typography"],
            "direction": "", "source_artwork": "", "dimensions": f"{a['width']}x{a['height']}",
            "format": a["format"], "validated": a["validated"],
        })
    for m in mock:
        rows.append({
            "file": m["file"], "library": "marketing-mockups", "language": m["language"],
            "style": m["style"], "scenario": m["scenario"], "story_type": "",
            "milestones": m["milestones"], "palette": "", "typography": "",
            "direction": m["direction"], "source_artwork": m["source_artwork"],
            "dimensions": f"{m['width']}x{m['height']}", "format": m["format"],
            "validated": m["validated"],
        })
    cols = ["file","library","language","style","scenario","story_type","milestones",
            "palette","typography","direction","source_artwork","dimensions","format","validated"]
    with open(ROOT/"manifest"/"manifest.csv","w",newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
    json.dump(rows, open(ROOT/"manifest"/"manifest.json","w"), ensure_ascii=False, indent=1)
    print("manifest rows:", len(rows))

if __name__ == "__main__":
    for loc in LANGS:
        artwork_sheet(loc)
    mockup_sheet()
    unified_manifest()
