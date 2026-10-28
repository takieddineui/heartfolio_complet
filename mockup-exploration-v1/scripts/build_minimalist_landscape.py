# -*- coding: utf-8 -*-
"""Landscape versions of the three MODERN-MINIMALIST variants.

Landscape canvas (3200x2560) with landscape source artwork (Song Poster Award
theme; the two horizontal Love Story Timeline layouts). Same three wall/frame
treatments as the portrait set. Sharp / in-focus, artwork composited UNCHANGED
(source sha256-verified). Procedural (Pillow) renders.
"""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import build_cinematic as bc

LW, LH = 3200, 2560           # landscape, 5:4
OUT = bc.LIB / "minimalist"

VARIANTS = {
    "v1-studio-white-landscape": dict(
        wall=("#f3f2ef", "#e8e7e3"), light=(0.34, 0.18, "#ffffff", 110), plaster=0.05,
        frame="#17181a", fw=0.015, bevel=(96,96,98,90), shelf=dict(col="#d6bb90", obj=True),
        box=(0.70, 0.60), cy=0.40, soft=24, dark=78, vig=24,
        art=("song-poster", "en/sp6-milestone-award.png"),
        note="off-white plaster · slim black frame · floating oak shelf"),
    "v2-gallery-white-landscape": dict(
        wall=("#fbfbfa", "#f0f0ef"), light=(0.40, 0.16, "#ffffff", 95), plaster=0.035,
        frame="#191a1c", fw=0.014, bevel=(96,96,98,90), shelf=None,
        box=(0.66, 0.56), cy=0.44, soft=18, dark=70, vig=18,
        art=("love-story-timeline", "en/s5-long-distance-horizontal-polaroid.png"),
        note="bright gallery white · slim black frame · no shelf"),
    "v3-concrete-oak-landscape": dict(
        wall=("#edeef0", "#dcdee1"), light=(0.32, 0.20, "#f4f6f8", 110), plaster=0.07,
        frame="#c7a877", fw=0.018, bevel=(245,232,208,80), shelf=dict(col="#cdb088", obj=True),
        box=(0.68, 0.58), cy=0.40, soft=24, dark=74, vig=22,
        art=("love-story-timeline", "en/s6-parents-story-horizontal-circles.png"),
        note="cool light-grey concrete · slim natural-oak frame · floating shelf"),
}

def build(name, v):
    scene = bc.vgrad((LW, LH), *v["wall"]).convert("RGB")
    scene = bc.plaster(scene, 8, v["plaster"])
    lx, ly, lcol, lstr = v["light"]
    scene = bc.apply_light(scene, int(LW*lx), int(LH*ly), int(LH*0.6), lcol, lstr, 0.45).convert("RGBA")
    art = Image.open(bc.SRCROOT / v["art"][0] / v["art"][1])    # read-only
    piece = bc.framed(art, frame_col=v["frame"], frame_w_frac=v["fw"], mat_col="#ffffff",
                      mat_frac=0.044, bevel_light=v["bevel"])
    piece = bc.fit(piece, int(LW*v["box"][0]), int(LH*v["box"][1]))
    px = (LW-piece.width)//2; py = int(LH*v["cy"]) - piece.height//2
    bc.frame_wall_shadow(scene, piece, px, py, soft=v["soft"], dark=v["dark"], off=(18, 24))
    if v["shelf"]:
        sy = int(LH*0.79); sx0, sx1 = int(LW*0.22), int(LW*0.78)
        us = Image.new("RGBA", (LW, LH), (0,0,0,0)); ImageDraw.Draw(us).rectangle([sx0, sy+30, sx1, sy+70], fill=(20,20,22,80))
        scene.alpha_composite(us.filter(ImageFilter.GaussianBlur(16)))
        scene.alpha_composite(bc.shaded_slab(sx1-sx0, 46, v["shelf"]["col"]), (sx0, sy))
        if v["shelf"]["obj"]:
            ox = int(LW*0.66); bc.contact_shadow(scene, ox+30, sy+4, 120, blur=20, alpha=70)
            d = ImageDraw.Draw(scene, "RGBA"); d.rectangle([ox, sy-120, ox+60, sy], fill=(206,201,194,255))
            d.rectangle([ox, sy-120, ox+60, sy-112], fill=(230,226,220,255))
    scene.alpha_composite(piece, (px, py))
    scene = bc.vignette(scene.convert("RGB"), v["vig"])
    OUT.mkdir(exist_ok=True)
    scene.save(OUT / f"{name}.jpg", quality=94)
    return {"file": f"minimalist/{name}.jpg", "variant": name, "orientation": "landscape",
            "direction": "modern-minimalist", "product": v["art"][0],
            "source_artwork": f"customer-artwork-library-v2/{v['art'][0]}/{v['art'][1]}",
            "canvas": f"{LW}x{LH}", "format": "JPG", "note": v["note"], "source_unchanged": True}

def main():
    manifest = []
    for name, v in VARIANTS.items():
        before = bc.file_hash(bc.SRCROOT / v["art"][0] / v["art"][1])
        row = build(name, v)
        assert bc.file_hash(bc.SRCROOT / v["art"][0] / v["art"][1]) == before
        manifest.append(row); print("rendered", name)
    (bc.LIB/"manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(bc.LIB/"manifest"/"minimalist_landscape_manifest.json", "w"), ensure_ascii=False, indent=1)
    print("DONE", len(manifest))

if __name__ == "__main__":
    main()
