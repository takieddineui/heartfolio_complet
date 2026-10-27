# -*- coding: utf-8 -*-
"""QA for the V2 customer-artwork library (Love Story Timeline + Song Poster).

Checks: only current styles/themes (read from the product source, no
obsolete/first-editions); expected counts; all six languages; every file a
valid non-empty image; no duplicate / missing / stray files; milestone counts
within product limits; the library is artwork-only (no mockup/marketing dirs);
and the LST artwork is byte-identical to the already-validated V2 set it was
copied from. Prints a PASS/FAIL report and exits non-zero on any failure.
"""
from __future__ import annotations
import re, sys, json, hashlib
from pathlib import Path
from PIL import Image

LIB = Path(__file__).resolve().parents[1]
REPO = LIB.parent
BACKEND = REPO / "backend"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from content_scenarios_lst import SCENARIOS as LST, LANGS
from content_songs import SONG_SCENARIOS as SONGS

def read_tuple(path, name):
    src = Path(path).read_text()
    m = re.search(name + r"\s*=\s*\((.*?)\)", src, re.S)
    return tuple(re.findall(r'"([a-z-]+)"', m.group(1)))

LST_DATA = BACKEND / "apps/delivery/product_renderers/love_story_timeline/data.py"
SONG_DATA = BACKEND / "apps/delivery/product_renderers/song_poster/data.py"
CURRENT_STYLES = read_tuple(LST_DATA, "LAYOUTS")
CURRENT_THEMES = read_tuple(SONG_DATA, "THEMES")

results = []
def check(name, ok, detail=""):
    results.append(ok); print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

print(f"Current LST styles  (from source): {CURRENT_STYLES}")
print(f"Current Song themes (from source): {CURRENT_THEMES}\n")
check("Six current LST styles", len(CURRENT_STYLES) == 6, str(len(CURRENT_STYLES)))
check("Eight current Song themes", len(CURRENT_THEMES) == 8, str(len(CURRENT_THEMES)))

def valid_image(p):
    try: Image.open(p).verify(); return True
    except Exception: return False

# ---- Love Story Timeline ----
lst_styles = {s["style"] for s in LST}
check("LST styles all current (no obsolete)", lst_styles <= set(CURRENT_STYLES), str(sorted(lst_styles)))
check("All six LST styles present", set(CURRENT_STYLES) <= lst_styles, f"missing={set(CURRENT_STYLES)-lst_styles}")
check("LST milestones within 3..8", all(3 <= s["milestones"] <= 8 for s in LST))
lst_expected = {f"love-story-timeline/{l}/{s['id']}-{s['style']}.png" for s in LST for l in LANGS}
lst_present = {str(p.relative_to(LIB)) for p in (LIB/"love-story-timeline").rglob("*.png")}
check("LST count = 36 (6 styles x 6 languages)", len(lst_present) == 36, str(len(lst_present)))
check("LST no missing files", lst_expected <= lst_present, str(sorted(lst_expected-lst_present)[:3]))
check("LST no stray files", lst_present <= lst_expected, str(sorted(lst_present-lst_expected)[:3]))
check("LST every file valid image", all(valid_image(LIB/f) for f in lst_present))

# LST byte-identical to the source V2 set it was copied from
src_lib = REPO / "lst-asset-library-v2" / "customer-artwork"
if src_lib.exists():
    def h(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
    same = all(h(LIB/f"love-story-timeline/{l}/{s['id']}-{s['style']}.png") ==
               h(src_lib/l/f"{s['id']}-{s['style']}.png") for s in LST for l in LANGS)
    check("LST artwork byte-identical to validated source (unchanged)", same)

# ---- Song Poster ----
song_themes = {s["theme"] for s in SONGS}
check("Song themes all current (no obsolete)", song_themes <= set(CURRENT_THEMES), str(sorted(song_themes)))
check("All eight Song themes present", set(CURRENT_THEMES) <= song_themes, f"missing={set(CURRENT_THEMES)-song_themes}")
song_expected = {f"song-poster/{l}/{s['id']}-{s['theme']}.png" for s in SONGS for l in LANGS}
song_present = {str(p.relative_to(LIB)) for p in (LIB/"song-poster").rglob("*.png")}
check("Song count = 48 (8 themes x 6 languages)", len(song_present) == 48, str(len(song_present)))
check("Song no missing files", song_expected <= song_present, str(sorted(song_expected-song_present)[:3]))
check("Song no stray files", song_present <= song_expected, str(sorted(song_present-song_expected)[:3]))
check("Song every file valid image", all(valid_image(LIB/f) for f in song_present))
# title/artist/dedication within caps
caps_ok = all(len(s["lang"][l]["track"]) <= 60 and len(s["lang"][l]["artist"]) <= 60
              and len(s["lang"][l].get("dedication","")) <= 180 for s in SONGS for l in LANGS)
check("Song fields within caps (track/artist<=60, dedication<=180)", caps_ok)

# ---- languages, duplicates, artwork-only ----
all_files = list((LIB/"love-story-timeline").rglob("*.png")) + list((LIB/"song-poster").rglob("*.png"))
check("All six languages present (both products)",
      all({p.parent.name for p in (LIB/prod).rglob("*.png")} == set(LANGS)
          for prod in ("love-story-timeline","song-poster")))
check("No zero-byte files", all(p.stat().st_size > 0 for p in all_files))
dups = [str(d) for d in {p.parent for p in all_files}
        if len([x for x in d.glob('*') if x.is_file()]) != len({x.name for x in d.glob('*') if x.is_file()})]
check("No duplicate filenames within any directory", not dups, "; ".join(dups))
# artwork-only: no mockup/marketing directories inside this library
banned = [d.name for d in LIB.iterdir() if d.is_dir() and d.name in
          ("marketing-mockups","mockups","lifestyle","framed","scenes")]
check("Artwork-only (no mockup/marketing directories)", not banned, ", ".join(banned))

# ---- manifest integrity ----
man = json.load(open(LIB/"manifest"/"manifest.json"))
check("Manifest rows = 84", len(man) == 84, str(len(man)))
check("Every manifest file exists", all((LIB/r["file"]).exists() for r in man))

print()
nfail = results.count(False)
print(f"=== {len(results)-nfail}/{len(results)} checks passed, {nfail} failed ===")
sys.exit(1 if nfail else 0)
