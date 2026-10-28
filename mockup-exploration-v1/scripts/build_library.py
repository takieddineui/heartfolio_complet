# -*- coding: utf-8 -*-
"""Generate the MINIMALIST mockup set (3 variants) across the full printable
library: every Love Story Timeline style and every Song Poster theme, each in
its native orientation (portrait styles -> portrait scenes; horizontal layouts
and the Award/Sleeve themes -> landscape scenes).

Output: heartfolio-mockup-library/<product>/<design>/<variant>.jpg
Artwork composited UNCHANGED (proportional scale only; source sha256-verified).
Procedural (Pillow) renders — no 3D engine / image model available here.
English by default (LANGS); set LANGS to all six for localized mockups.
"""
from __future__ import annotations
import json, csv, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cinematic as bc

REPO = bc.LIB.parents[0]
SRC = REPO / "customer-artwork-library-v2"
OUTLIB = REPO / "heartfolio-mockup-library"
LANGS = ["en"]            # set to ["en","fr","ar","es","ru","zh-CN"] for all languages
PRODUCTS = ["love-story-timeline", "song-poster"]

STYLES = ["neat-stack", "alternating-tilt", "overlapping-cascade", "dotted-branching",
          "horizontal-polaroid", "horizontal-circles"]
THEMES = ["player", "ledger", "ephemeris", "contactsheet", "label", "award", "sleeve", "mosaic"]

# three minimalist wall/frame treatments (orientation-agnostic)
VARIANTS = {
    "studio-white": dict(wall=("#f3f2ef", "#e8e7e3"), light=(0.34, 0.18, "#ffffff", 110), plaster=0.05,
                         frame="#17181a", fw=0.015, bevel=(96,96,98,90), shelf=dict(col="#d6bb90", obj=True),
                         vig=24, soft=22, dark=78),
    "gallery-white": dict(wall=("#fbfbfa", "#f0f0ef"), light=(0.40, 0.16, "#ffffff", 95), plaster=0.035,
                          frame="#191a1c", fw=0.014, bevel=(96,96,98,90), shelf=None,
                          vig=18, soft=18, dark=70),
    "concrete-oak": dict(wall=("#edeef0", "#dcdee1"), light=(0.32, 0.20, "#f4f6f8", 110), plaster=0.07,
                         frame="#c7a877", fw=0.018, bevel=(245,232,208,80), shelf=dict(col="#cdb088", obj=True),
                         vig=22, soft=24, dark=74),
}
# per-orientation framing box + composition
PORT = dict(size=(2560, 3200), box={"gallery-white": (0.60, 0.58)}, box_def=(0.66, 0.62),
            cy={"gallery-white": 0.44}, cy_def=0.40, shelf_y=0.74, shelf_x=(0.20, 0.80))
LAND = dict(size=(3200, 2560), box={"gallery-white": (0.66, 0.56)}, box_def=(0.70, 0.60),
            cy={"gallery-white": 0.44}, cy_def=0.40, shelf_y=0.79, shelf_x=(0.22, 0.78))

def design_of(stem):
    for s in STYLES + THEMES:
        if stem.endswith(s): return s
    return stem

def render(art, vname, v, orient):
    O = LAND if orient == "landscape" else PORT
    W, H = O["size"]
    scene = bc.vgrad((W, H), *v["wall"]).convert("RGB")
    scene = bc.plaster(scene, 8, v["plaster"])
    lx, ly, lcol, lstr = v["light"]
    scene = bc.apply_light(scene, int(W*lx), int(H*ly), int(max(W, H)*0.38), lcol, lstr, 0.45).convert("RGBA")
    piece = bc.framed(art, frame_col=v["frame"], frame_w_frac=v["fw"], mat_col="#ffffff",
                      mat_frac=0.044, bevel_light=v["bevel"])
    box = O["box"].get(vname, O["box_def"]); cy = O["cy"].get(vname, O["cy_def"])
    piece = bc.fit(piece, int(W*box[0]), int(H*box[1]))
    px = (W-piece.width)//2; py = int(H*cy) - piece.height//2
    bc.frame_wall_shadow(scene, piece, px, py, soft=v["soft"], dark=v["dark"], off=(17, 23))
    if v["shelf"]:
        sy = int(H*O["shelf_y"]); sx0, sx1 = int(W*O["shelf_x"][0]), int(W*O["shelf_x"][1])
        us = Image.new("RGBA", (W, H), (0,0,0,0)); ImageDraw.Draw(us).rectangle([sx0, sy+30, sx1, sy+70], fill=(20,20,22,80))
        scene.alpha_composite(us.filter(ImageFilter.GaussianBlur(16)))
        scene.alpha_composite(bc.shaded_slab(sx1-sx0, 46, v["shelf"]["col"]), (sx0, sy))
        if v["shelf"]["obj"]:
            ox = int(W*0.65); bc.contact_shadow(scene, ox+30, sy+4, 120, blur=20, alpha=70)
            d = ImageDraw.Draw(scene, "RGBA"); d.rectangle([ox, sy-120, ox+60, sy], fill=(206,201,194,255))
            d.rectangle([ox, sy-120, ox+60, sy-112], fill=(230,226,220,255))
    scene.alpha_composite(piece, (px, py))
    return bc.vignette(scene.convert("RGB"), v["vig"]), f"{W}x{H}"

def main():
    manifest = []
    for product in PRODUCTS:
        for lang in LANGS:
            for art_path in sorted((SRC / product / lang).glob("*.png")):
                stem = art_path.stem; design = design_of(stem)
                art = Image.open(art_path)          # read-only
                orient = "landscape" if art.width > art.height else "portrait"
                before = bc.file_hash(art_path)
                for vname, v in VARIANTS.items():
                    scene, canvas = render(art, vname, v, orient)
                    outdir = OUTLIB / product / (design if len(LANGS) == 1 else f"{lang}/{design}")
                    outdir.mkdir(parents=True, exist_ok=True)
                    scene.save(outdir / f"{vname}.jpg", quality=92)
                    manifest.append({
                        "file": str((outdir / f"{vname}.jpg").relative_to(OUTLIB)), "product": product,
                        "design": design, "variant": vname, "orientation": orient, "language": lang,
                        "source_artwork": str(art_path.relative_to(REPO)), "canvas": canvas,
                        "format": "JPG", "source_unchanged": bc.file_hash(art_path) == before})
                print("done", product, lang, design, orient)
    (OUTLIB / "manifest").mkdir(parents=True, exist_ok=True)
    json.dump(manifest, open(OUTLIB/"manifest"/"manifest.json", "w"), ensure_ascii=False, indent=1)
    cols = ["file","product","design","variant","orientation","language","source_artwork","canvas","format","source_unchanged"]
    with open(OUTLIB/"manifest"/"manifest.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(manifest)
    allok = all(r["source_unchanged"] for r in manifest)
    print(f"\nDONE {len(manifest)} mockups  ·  sources unchanged: {allok}")

if __name__ == "__main__":
    main()
