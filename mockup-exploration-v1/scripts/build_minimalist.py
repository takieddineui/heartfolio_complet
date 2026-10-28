# -*- coding: utf-8 -*-
"""Three mockups in the MODERN-MINIMALIST family (the kept direction).

Clean architectural walls, slim frames, crisp daylight and sharp shadows —
three distinct-but-cohesive variants. Sharp / in-focus, 2560x3200. Artwork
composited UNCHANGED (proportional scale only; source sha256-verified).
Procedural (Pillow) — no 3D engine / image model available here.
"""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import build_cinematic as bc

W, H = bc.W, bc.H
OUT = bc.LIB / "minimalist"

# variant: wall gradient, frame colour, frame width, mat, bevel, shelf?, artwork
VARIANTS = {
    "v1-studio-white": dict(
        wall=("#f3f2ef", "#e8e7e3"), light=(0.34, 0.18, "#ffffff", 110), plaster=0.05,
        frame="#17181a", fw=0.015, mat="#ffffff", bevel=(96,96,98,90),
        shelf=dict(col="#d6bb90", obj=True), box=(0.66, 0.62), cy=0.40, soft=22, dark=78, vig=24,
        art=("song-poster", "en/sp1-first-dance-player.png"),
        note="soft off-white plaster wall · slim black frame · floating oak shelf"),
    "v2-gallery-white": dict(
        wall=("#fbfbfa", "#f0f0ef"), light=(0.40, 0.16, "#ffffff", 95), plaster=0.035,
        frame="#191a1c", fw=0.014, mat="#ffffff", bevel=(96,96,98,90),
        shelf=None, box=(0.60, 0.58), cy=0.44, soft=18, dark=70, vig=18,
        art=("love-story-timeline", "en/s1-new-love-neat-stack.png"),
        note="bright white gallery wall · slim black frame · no shelf, generous negative space"),
    "v3-concrete-oak": dict(
        wall=("#edeef0", "#dcdee1"), light=(0.32, 0.20, "#f4f6f8", 110), plaster=0.07,
        frame="#c7a877", fw=0.018, mat="#ffffff", bevel=(245,232,208,80),
        shelf=dict(col="#cdb088", obj=True), box=(0.64, 0.60), cy=0.40, soft=24, dark=74, vig=22,
        art=("love-story-timeline", "en/s4-engaged-wedding-dotted-branching.png"),
        note="cool light-grey concrete wall · slim natural-oak frame · thin floating shelf"),
}

def build(name, v):
    scene = bc.vgrad((W, H), *v["wall"]).convert("RGB")
    scene = bc.plaster(scene, 8, v["plaster"])
    lx, ly, lcol, lstr = v["light"]
    scene = bc.apply_light(scene, int(W*lx), int(H*ly), int(H*0.5), lcol, lstr, 0.45).convert("RGBA")
    art = Image.open(bc.SRCROOT / v["art"][0] / v["art"][1])  # read-only
    piece = bc.framed(art, frame_col=v["frame"], frame_w_frac=v["fw"], mat_col=v["mat"],
                      mat_frac=0.044, bevel_light=v["bevel"])
    piece = bc.fit(piece, int(W*v["box"][0]), int(H*v["box"][1]))
    px = (W-piece.width)//2; py = int(H*v["cy"]) - piece.height//2
    bc.frame_wall_shadow(scene, piece, px, py, soft=v["soft"], dark=v["dark"], off=(16, 22))
    if v["shelf"]:
        sy = int(H*0.74); sx0, sx1 = int(W*0.20), int(W*0.80)
        us = Image.new("RGBA", (W, H), (0,0,0,0)); ImageDraw.Draw(us).rectangle([sx0, sy+30, sx1, sy+70], fill=(20,20,22,80))
        scene.alpha_composite(us.filter(ImageFilter.GaussianBlur(16)))
        scene.alpha_composite(bc.shaded_slab(sx1-sx0, 46, v["shelf"]["col"]), (sx0, sy))
        if v["shelf"]["obj"]:
            ox = int(W*0.64); bc.contact_shadow(scene, ox+30, sy+4, 110, blur=20, alpha=70)
            d = ImageDraw.Draw(scene, "RGBA"); d.rectangle([ox, sy-120, ox+60, sy], fill=(206,201,194,255))
            d.rectangle([ox, sy-120, ox+60, sy-112], fill=(230,226,220,255))
    scene.alpha_composite(piece, (px, py))
    scene = bc.vignette(scene.convert("RGB"), v["vig"])
    OUT.mkdir(exist_ok=True)
    scene.save(OUT / f"{name}.jpg", quality=94)
    return {"file": f"minimalist/{name}.jpg", "variant": name, "direction": "modern-minimalist",
            "product": v["art"][0], "source_artwork": f"customer-artwork-library-v2/{v['art'][0]}/{v['art'][1]}",
            "canvas": f"{W}x{H}", "format": "JPG", "note": v["note"], "source_unchanged": True}

def main():
    manifest = []
    for name, v in VARIANTS.items():
        before = bc.file_hash(bc.SRCROOT / v["art"][0] / v["art"][1])
        row = build(name, v)
        assert bc.file_hash(bc.SRCROOT / v["art"][0] / v["art"][1]) == before
        manifest.append(row); print("rendered", name)
    (bc.LIB/"manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(bc.LIB/"manifest"/"minimalist_manifest.json", "w"), ensure_ascii=False, indent=1)
    print("DONE", len(manifest))

if __name__ == "__main__":
    main()
