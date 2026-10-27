# -*- coding: utf-8 -*-
"""Contact sheets: every static image as a labelled grid, plus a few frames
from each reel — one sheet pair per language."""
from __future__ import annotations
import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import brandkit as bk

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "contact-sheets"; OUT.mkdir(exist_ok=True)
F = bk.F_SANS
LOCNAME = {"en": "English", "fr": "Français", "ar": "العربية"}

def thumb(im, bw, bh, pad=8, bg=(255,253,248)):
    cell = Image.new("RGB", (bw, bh), bg)
    t = bk.fit(im, bw-2*pad, bh-2*pad)
    cell.paste(t, ((bw-t.width)//2, (bh-t.height)//2))
    ImageDraw.Draw(cell).rectangle([0,0,bw-1,bh-1], outline=(220,212,196), width=1)
    return cell

def label(text, w, h=34, fill=(20,27,46), bg=(247,241,230), size=18, locale="en"):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(bk.F_NASKH if locale=="ar" else F, size)
    # truncate
    s = text
    while bk.line_w(d, s, f, locale) > w-10 and len(s) > 4:
        s = s[:-2]
    d.text((6, (h-size)//2-2), s, font=f, fill=fill, language=bk._lang(locale))
    return im

def section_header(text, w, size=30):
    im = Image.new("RGB", (w, 54), (20,27,46))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(F, size)
    d.text((16, 10), text, font=f, fill=(247,241,230))
    return im

def collect(locale):
    groups = []  # (title, [paths])
    specs = [
        ("SERIES A · Posts (1080×1080)", f"series-a-posters/{locale}/posts"),
        ("SERIES A · Carousel — One story, six styles (1080×1350)", f"series-a-posters/{locale}/carousel-six-styles"),
        ("SERIES A · Flat prints (1080×1350)", f"series-a-posters/{locale}/flats"),
        ("SERIES A · Framed mockups (1080×1350)", f"series-a-posters/{locale}/framed"),
        ("SERIES B · Posts (1080×1080)", f"series-b-live/{locale}/posts"),
        ("SERIES B · Carousel — How Heartfolio works (1080×1350)", f"series-b-live/{locale}/carousel-how-it-works"),
        ("SERIES B · Carousel — Reasons I love you: examples (1080×1350)", f"series-b-live/{locale}/carousel-reasons-examples"),
    ]
    for title, rel in specs:
        d = ROOT / rel
        if d.exists():
            paths = sorted([p for p in d.iterdir() if p.suffix.lower() in (".png",".jpg",".jpeg")])
            if paths:
                groups.append((title, paths))
    return groups

def build_sheet(locale):
    groups = collect(locale)
    cols = 6
    bw, bh, lh, gap = 300, 300, 30, 10
    W = 40 + cols*bw + (cols-1)*gap
    # compute height
    blocks = []
    for title, paths in groups:
        rows = (len(paths)+cols-1)//cols
        blocks.append((title, paths, rows))
    H = 150
    for _,_,rows in blocks:
        H += 54 + 14 + rows*(bh+lh+gap) + 20
    sheet = Image.new("RGB", (W, H), (235,230,222))
    d = ImageDraw.Draw(sheet)
    # title bar
    tf = ImageFont.truetype(F, 42)
    d.text((40, 36), "Heartfolio — Social pack contact sheet", font=tf, fill=(20,27,46))
    sf = ImageFont.truetype(bk.F_NASKH if locale=="ar" else F, 26)
    d.text((40, 92), f"{LOCNAME[locale]}  ·  static images  (reels on the companion sheet)",
           font=sf, fill=(58,58,56), language=bk._lang(locale))
    y = 150
    for title, paths, rows in blocks:
        hdr = section_header(title, W-80)
        sheet.paste(hdr, (40, y)); y += 54+14
        for i, p in enumerate(paths):
            r, c = divmod(i, cols)
            x = 40 + c*(bw+gap)
            yy = y + r*(bh+lh+gap)
            im = Image.open(p).convert("RGB")
            sheet.paste(thumb(im, bw, bh), (x, yy))
            sheet.paste(label(p.name, bw, lh, locale=locale), (x, yy+bh))
        y += rows*(bh+lh+gap) + 20
    out = OUT / f"contact-sheet-{locale}.png"
    sheet.save(out)
    print("sheet", out, sheet.size)
    return out

def reel_frames(locale):
    reels = sorted(list((ROOT/"series-a-posters"/locale/"reels").glob("*.mp4")) +
                   list((ROOT/"series-b-live"/locale/"reels").glob("*.mp4")))
    if not reels:
        print("no reels for", locale); return None
    nframes = 4
    bw, bh, lh, gap = 230, 409, 30, 10
    cols = nframes
    W = 60 + cols*bw + (cols-1)*gap
    H = 150 + len(reels)*(bh+lh+40)
    sheet = Image.new("RGB", (W, H), (235,230,222))
    d = ImageDraw.Draw(sheet)
    tf = ImageFont.truetype(F, 40)
    d.text((40, 36), "Heartfolio — Social pack · reel frames", font=tf, fill=(20,27,46))
    sf = ImageFont.truetype(bk.F_NASKH if locale=="ar" else F, 26)
    d.text((40, 92), f"{LOCNAME[locale]}  ·  {len(reels)} reels (1080×1920), 4 frames each",
           font=sf, fill=(58,58,56), language=bk._lang(locale))
    y = 150
    for reel in reels:
        dur = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
                    "-of","csv=p=0",str(reel)], capture_output=True, text=True).stdout.strip() or 18)
        times = [dur*t for t in (0.08, 0.35, 0.62, 0.9)]
        d.rectangle([40, y, W-40, y+28], fill=(201,162,75))
        d.text((48, y+3), reel.name, font=ImageFont.truetype(F, 20), fill=(20,27,46))
        y += 36
        for i, t in enumerate(times):
            fp = Path("/tmp") / f"rf_{locale}_{i}.png"
            subprocess.run(["ffmpeg","-y","-ss",f"{t}","-i",str(reel),"-frames:v","1",str(fp)],
                           capture_output=True)
            if fp.exists():
                im = Image.open(fp).convert("RGB")
                sheet.paste(thumb(im, bw, bh), (60+i*(bw+gap), y))
        y += bh + 40
    out = OUT / f"reel-frames-{locale}.png"
    sheet.save(out)
    print("reel sheet", out, sheet.size)
    return out

if __name__ == "__main__":
    locs = sys.argv[1:] or ["en","fr","ar"]
    for loc in locs:
        build_sheet(loc)
        reel_frames(loc)
