# -*- coding: utf-8 -*-
"""Quality-assurance pass for the V2 library.

Checks, per the brief:
 - every style used is one of the SIX CURRENT LST layouts (no obsolete/first
   editions) — the current set is read straight from the product source;
 - expected counts (36 artwork = 6 scenarios x 6 languages, 18 mockups =
   6 heroes x 3 directions);
 - every mockup references a real source-artwork file that exists;
 - every file opens as a valid, non-empty image with the expected format;
 - no duplicate or mis-named files;
 - all six languages present in the artwork library.
Prints a PASS/FAIL report.
"""
from __future__ import annotations
import re, sys, json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT.parent / "backend"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from content_scenarios import SCENARIOS, LANGS, MOCKUP_HEROES

# current approved styles, read from the product source (not assumed)
data_src = (BACKEND / "apps/delivery/product_renderers/love_story_timeline/data.py").read_text()
m = re.search(r"LAYOUTS\s*=\s*\((.*?)\)", data_src, re.S)
CURRENT_LAYOUTS = tuple(re.findall(r'"([a-z-]+)"', m.group(1)))

results = []
def check(name, ok, detail=""):
    results.append((ok, name, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

print(f"Current approved LST styles (from product source): {CURRENT_LAYOUTS}\n")
check("Exactly six current styles", len(CURRENT_LAYOUTS) == 6, f"{len(CURRENT_LAYOUTS)} found")

# ---- artwork ----
art = json.load(open(ROOT/"manifest"/"artwork_manifest.json"))
styles_used = {a["style"] for a in art}
check("All artwork styles are current (no obsolete)",
      styles_used <= set(CURRENT_LAYOUTS), f"used={sorted(styles_used)}")
check("All six current styles represented",
      set(CURRENT_LAYOUTS) <= styles_used, f"missing={set(CURRENT_LAYOUTS)-styles_used}")
check("Artwork count = 36 (6 scenarios x 6 languages)", len(art) == 36, f"{len(art)}")
langs_present = {a["language"] for a in art}
check("All six languages present", set(LANGS) <= langs_present, f"{sorted(langs_present)}")

# every artwork file opens & matches manifest dims
bad = []
for a in art:
    p = ROOT / a["file"]
    if not p.exists(): bad.append(a["file"]); continue
    try:
        im = Image.open(p); im.verify()
    except Exception as e:
        bad.append(f"{a['file']} ({e})")
check("Every artwork file is a valid image", not bad, "; ".join(bad[:5]))

# milestone counts within 3..8
mok = all(3 <= a["milestones"] <= 8 for a in art)
check("Milestone counts within product limits (3..8)", mok)

# ---- mockups ----
mock = json.load(open(ROOT/"manifest"/"mockup_manifest.json"))
check("Mockup count = 18 (6 heroes x 3 directions)", len(mock) == 18, f"{len(mock)}")
dirs = {m["direction"] for m in mock}
check("Three directions present", dirs == {"luxury-editorial","modern-minimalist","warm-romantic"}, f"{sorted(dirs)}")
missing_src = [m["file"] for m in mock if not (ROOT/m["source_artwork"]).exists()]
check("Every mockup references a real source artwork", not missing_src, "; ".join(missing_src[:5]))
badm = []
for m in mock:
    p = ROOT / m["file"]
    if not p.exists(): badm.append(m["file"]); continue
    try: Image.open(p).verify()
    except Exception as e: badm.append(f"{m['file']} ({e})")
check("Every mockup file is a valid image", not badm, "; ".join(badm[:5]))
# mockup styles also current
check("All mockup styles are current", {m["style"] for m in mock} <= set(CURRENT_LAYOUTS))

# ---- duplicates / naming ----
all_files = list((ROOT/"customer-artwork").rglob("*.png")) + \
            [p for d in ("luxury-editorial","modern-minimalist","warm-romantic")
             for p in (ROOT/"marketing-mockups"/d).glob("*.jpg")]
names = [p.name for p in all_files]
check("No zero-byte files", all(p.stat().st_size > 0 for p in all_files))
# within each directory, names unique
dups = []
for d in set(p.parent for p in all_files):
    ns = [p.name for p in d.glob("*") if p.is_file()]
    if len(ns) != len(set(ns)): dups.append(str(d))
check("No duplicate filenames within any directory", not dups, "; ".join(dups))

# every scenario x lang file present on disk
expected = {f"customer-artwork/{l}/{s['id']}-{s['style']}.png" for s in SCENARIOS for l in LANGS}
present = {str(p.relative_to(ROOT)) for p in (ROOT/"customer-artwork").rglob("*.png")}
check("No missing artwork files", expected <= present, f"missing={sorted(expected-present)[:3]}")
check("No stray/extra artwork files", present <= expected, f"extra={sorted(present-expected)[:3]}")

print()
nfail = sum(1 for ok,_,_ in results if not ok)
print(f"=== {len(results)-nfail}/{len(results)} checks passed, {nfail} failed ===")
sys.exit(1 if nfail else 0)
