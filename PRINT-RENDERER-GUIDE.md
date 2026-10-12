# Print renderer guide — read before working on any Love Story Timeline style

Written 6 Oct 2026, after Neat Stack was taken from "looks right in the
Studio" to "the downloaded print is right". Every bug below was found in
Neat Stack the hard way, one style at a time. **The other five styles share
most of the same code, so expect the same bugs there and check for them on
purpose before a customer's real content finds them.**

---

## 1. The core problem: two independent renderers

The design exists twice, with no shared source of truth:

| | Studio preview | Downloaded print |
|---|---|---|
| Code | `frontend-heartfolio/src/lib/studio/product-modules/love-story-timeline/renderer.tsx` + `renderer.module.css` | `backend/apps/delivery/product_renderers/love_story_timeline/png_renderer.py` (Pillow) |
| What it is | HTML/CSS in a browser | Pixels drawn one call at a time |

The only bridge is `compositions.py` (a few numbers per composition), which
`composition-parity.test.ts` checks against the CSS. **It only covers the
numbers someone deliberately put there.** Everything else (alignment,
tilt, shadow, which fields are drawn, fonts, spacing) can drift silently,
and has:

- **Content the print never drew.** The subtitle was validated, stored,
  previewed and shown on the live page, but the print skipped it on every
  layout (fixed 6 Oct). Milestone **locations** were missing from the
  Cascade, Alternating Tilt and Dotted Branching prints, though their
  previews showed them (fixed 6 Oct). Not every absence is a bug:
  Alternating Tilt and Dotted Branching omit the **description** on purpose
  ("photo-led", after reference posters 2, 4 and 7). That is
  `shows_description = False` in `compositions.py`, mirrored by
  `.layoutAlternating/.layoutDotted .neatDescription { display: none }` in
  the CSS and pinned by the parity test, all added together on 12 Sep 2026.
  The live preview confirms it: descriptions hidden on those two, shown on
  Neat Stack and Cascade. **Check the CSS and the live preview, not just the
  JSX, before calling a field missing.** On 6 Oct the JSX alone made this
  look like a mismatch, and it wasn't.
- **Values only half-pinned.** The parity test asserted `rotate(-2deg)`
  under a comment claiming the print tilted the cards. The print drew them
  flat, and the even cards' `1.6deg` was pinned nowhere (fixed 6 Oct).
- **Styling that diverged.** Header and footer alignment, card tilt and
  shadow (fixed for Neat Stack). Fonts, weights, title colour and case, the
  divider and the polaroid border thickness are still deferred.

### Two categories: always say which one a finding is

1. **Layout correctness** is anything a customer would see as broken:
   collisions, overflow, truncation, and **missing content**. Missing or cut
   customer text is the most serious kind. These get fixed.
2. **Styling drift** is a design difference that isn't broken. It only gets
   fixed when the user scopes it explicitly. Never fix it silently, and
   never skip mentioning it.

---

## 2. How to read the preview's real values (the standard method)

Don't eyeball screenshots. Do both of these:

1. **Read the rule** in `renderer.module.css` (`grep -n "text-align\|rotate(\|box-shadow"`).
2. **Confirm it live.** Open `http://localhost:3000/en/studio/love-story-timeline`,
   pick the style, and read the computed values in the browser. Use
   `offsetWidth`/`offsetHeight`, which ignore transforms:

```js
const poster = document.querySelector('[class*="poster"]');
const pick = el => { const cs = getComputedStyle(el); return {
  cls: el.className.split('__').pop(), textAlign: cs.textAlign, transform: cs.transform,
  boxShadow: cs.boxShadow, padding: cs.padding, fontSize: cs.fontSize,
  fontWeight: cs.fontWeight, textTransform: cs.textTransform,
  w: el.offsetWidth, h: el.offsetHeight }; };
JSON.stringify({
  poster: [poster.offsetWidth, poster.offsetHeight],
  header: [...poster.querySelector('header').children].map(pick),
  footer: poster.querySelector('footer') && pick(poster.querySelector('footer')),
  // replace with the style's card class, e.g. altPhoto, cascadePhoto, dottedPhoto, hPolaroid
  cards: [...poster.querySelectorAll('[class*="neatPhoto"]')].filter(e => e.tagName === 'SPAN').map(pick),
}, null, 1);
```

Measured for Neat Stack: the poster was 540×810, the card 156×167 and the
photo 146px.

### Converting CSS to Pillow

- **Rotation sign.** CSS `rotate(+a)` is clockwise; Pillow
  `Image.rotate(+a)` is anticlockwise. The preview's `rotate(-2deg)` is
  `+2.0` in Pillow. Check the matrix in `transform`: `matrix(cos, sin, …)`
  with a negative `sin` means anticlockwise.
- **Rotation origin.** CSS rotates about the element's centre, so rotate
  each card about its own centre (`_paste_polaroid`).
- **Shadow.** `box-shadow: 0 Ypx Bpx rgba(0,0,0,a)` means offset Y, a
  Gaussian with sigma B/2, and black at opacity a. CSS pixels are absolute,
  so convert through the photo's width in the preview: print px = CSS px ×
  (print photo size ÷ preview photo width). This keeps the shadow the same
  size relative to the photo. Write down the preview width you measured;
  the ratio changes if the Studio draws the poster at a different size.
- **Centring.** `text-align: center` centres by the line's *advance* width,
  so use `draw.textlength`, not the glyph bounding box (`_line_x`,
  `_draw_wrapped(centered=True)`).
- **Antialiased rotated edges.** Rotate in premultiplied alpha
  (`convert("RGBa")`), or the edge picks up a dark fringe.
- Put each new shared value in `compositions.py` and pin it in
  `composition-parity.test.ts`. Use the `cssRule(selector)` helper there so
  the assertion targets one rule, not "somewhere in the file".

---

## 3. Bugs to check for in every style

### 3a. Milestone text crowding: the shared size estimate is wrong

`render_png` sizes milestone text with one shared formula:

```python
required_height = small_font.size * 1.4 + body_font.size * 1.3 + small_font.size * 1.3 * 2
```

Measured against the real drawing, it **undercounts a full milestone by
21–25%**:

- it leaves out the location line;
- it assumes tighter spacing than the drawing uses (1.5/1.35 against
  1.4/1.3);
- it reserves **no space between milestones**.

Text that "fits" therefore fills its whole slot and runs into the next
milestone. That showed up as a 9px gap on the 8×10 edged print at text
scale 130 with long names, and outright overlap with 8 milestones.

Neat Stack no longer uses it. `_fit_neat_stack_text` measures each
milestone's real wrapped height with the drawing's own fonts and widths,
plus one line of separation; Alternating Tilt now does the same
(`_fit_milestone_text`, §7), and so do Overlapping Cascade (§9) and Dotted
Branching (§10), and both Horizontal styles (§11). **Every style now measures
its own milestones; the shared estimate in `render_png` still sizes the
fonts handed to the legacy wallpaper and card paths, nothing else.** Assume it is
wrong for them, in either direction (it overcounted on Alternating Tilt). Check by instrumenting estimate against actual: exec a copy of
the module in memory with a probe line after `slot_height = ...`, and
compare it with the drawn text extents.

Related limit: at the smallest text size (55%), some combinations can't
fit at all. For Neat Stack, the names heading on a sold print gives up room
when that happens (`_neat_stack_names_font`). Decide per style whether the
same applies.

**Known, accepted limit (decided 6 Oct 2026).** One Neat Stack combination
still crowds: 8 milestones, a 60-character subtitle, a 180-character
dedication, text scale 130, on the 8×10 edged print. Each milestone is 26px
short (short names) or 42px short (long names), with the names heading
already at its floor. It needs four independent fields at their maximum at
once, so the crowding is accepted rather than adding subtitle or dedication
shrinking. Revisit only if real orders reach it.

### 3b. Card overflow: size the whole card, not the photo

Neat Stack capped the **photo** at its slot height, then added the
polaroid borders on top (6% top, 19% bottom). The card came out about 1.3×
its slot, centred on it. The first card crossed the header rule and the
duration line, the last one sat under "To be continued…", and neighbours
overlapped by a quarter of a card. Drawn flat white, the column read as one
white strip.

Fixed by capping the **whole card**, and once tilted the **rotated
bounding box** (`h·cos θ + w·sin θ`), at the slot minus a gap. The other
styles' card code (`_draw_horizontal`) sizes from the photo too.
Overlapping Cascade did, at 1.20–1.44× its slot, until 7 Oct (§9), and
Dotted Branching, at 1.03–1.38×, until 12 Oct (§10). The Horizontal styles had
no card overflow (their trouble was text, §11). Alternating Tilt did as well, at 1.01–1.14× its
slot, until 7 Oct (§7); its fix also counts the shadow. Check every style
with photo cards.

### 3c. Lines that should wrap but don't

Any text drawn with a single `draw.text` can run off the page. Neat Stack
had this for the names header, the event titles and the locations. Event
titles are still unwrapped in all four of the other layout functions.
Names and titles are never truncated; descriptions keep their deliberate
one- or two-line limit.

### 3d. Customer text cut with an ellipsis

`_draw_wrapped(max_lines=…)` appends "…". Check every limit against the
field's maximum length at text scale 130 on the narrowest print:

- the 4-line names limit was raised for this reason;
- the dedication (max 180 characters) was capped at 3 lines and cut on
  the edged prints at 130 (fixed 6 Oct: no line limit);
- descriptions dropping to one line is a deliberate, deferred behaviour.

### 3e. Fields the preview shows and the print doesn't

For each style, list every field the preview's composition actually
*displays*. That's `renderer.tsx` plus any CSS that hides it, confirmed in
the live Studio with computed `display`. Then check the print draws it
too. That's how the subtitle
and the missing locations were found.

**Printing text that was missing makes the page fuller.** Adding the
locations exposed the unreviewed layouts' crowding and card overflow (§3a,
§3b) in 27 of 108 Overlapping Cascade renders and 28 of 108 Alternating Tilt
renders (none on Dotted Branching). Expect that when a missing field is
restored, and fix the fit in the same style's pass rather than leaving the
text out.

### 3f. Measuring must equal drawing

When layout decisions depend on how tall something will be, measure through
the drawing code itself, not a copy of its arithmetic:
`_draw_header(measure_only=True)` and `_draw_wrapped(measure_only=True)`.
`HeaderMeasureMatchesDrawingTests` holds them equal.

---

## 4. Practicalities that cost time

- **Restart `api` after any renderer change.** Gunicorn runs without
  `--reload`. The code is mounted (`./backend:/app`), so no rebuild is
  needed, but the running server keeps the old code until restarted. No
  renders are cached.

  ```bash
  docker compose restart api
  ```

- **Never judge layout with `customer=None`.** The card code only runs with
  a customer, so every photo is skipped. That is exactly how the card
  overflow was missed the first time. Use real uploaded JPEGs
  (`upload_asset` in tests), or stub `get_asset_bytes_for_customer` in a
  probe.
- **Never judge with thin data.** Use a dedication, the duration line,
  ending text, maximum-length fields and long names. Missing header and
  footer lines remove the very surfaces things collide with.
- **Check every output, not just the sold prints.** That means the legacy
  `*-png` targets (kept for re-downloads; they take layout improvements, by
  decision), the wallpapers and the AR card. Compare old and new code
  byte-for-byte: exec the backed-up module in memory and hash both renders.
  Anything that changes must be explained.
- **Don't copy files into `backend/`.** It's the live mount. Pass scripts to
  `manage.py shell` on stdin, and put backups in a scratch directory.
- **Run the full suite on its own.** Two tests are wall-clock sensitive (a
  Paddle webhook signature test and an R2 stall timing test) and flake
  under load.

---

## 5. Is this style actually done?

Do all of these. Each item was learned from a bug.

1. **Measure the preview's real values** (§2) for alignment, tilt, shadow,
   card size, and every field drawn. List the differences and label each as
   layout correctness or styling drift.
2. **Render the real print** with real photo bytes and the full header and
   footer, and look at it next to the live Studio preview, not just one or
   the other.
3. **Stress matrix:** compare against both the preview and a real rendered
   print file. Check every axis:
   - all 6 print sizes (`print-{a4,classic,poster}-{edged,frameless}`);
   - text scale 70, 100 and 130;
   - short names ("Emma & James") and long ones ("Alexandra
     Konstantinopol" & "Maximilian von Habsburg"), plus a single
     24-character word and a many-short-words pair;
   - 3, 5 and 8 milestones, with milestones at maximum field length (title
     40, description 140, location 40), plus a 60-character subtitle, also
     in capitals, and a 180-character dedication;
   - photos that are landscape, portrait and square, since the cards crop
     to a centre square;
   - legacy targets, wallpapers and the AR card, checked for unintended
     changes.
4. **What to check in each render:**
   - no text overlaps text;
   - nothing runs off the canvas;
   - no card or shadow covers text or crosses the header rule;
   - neighbouring cards keep a visible gap;
   - the space between milestones is larger than the space inside one;
   - no customer text is missing or cut;
   - the header is aligned as the preview has it.
5. **Write tests from the existing Neat Stack classes** in
   `love_story_timeline/tests.py`:
   - `NeatStackCardsFitTheirSlotsTests`
   - `NeatStackMilestoneTextFitsTests`
   - `NeatStackNamesGiveUpRoomOnlyWhenNeededTests`
   - `NeatStackMatchesThePreviewTests`
   - `NamesAreNeverTruncatedTests`
   - `SubtitleIsPrintedTests`
   - `HeaderMeasureMatchesDrawingTests`

   Read cards through `_paste_polaroid`, which returns the tilted card's
   bounding box and its shadow's visible extent, not by spotting flat
   rectangles.
6. **Mutation-check each fix.** Put the old behaviour back, confirm the
   test fails for the right reason, and restore the file by checksum. If a
   mutation survives, the test is wrong. Twice this round, a surviving
   mutation exposed a test that couldn't fail.
7. **Run the full suite on its own** and diff it against the baseline: same
   failing IDs, and identical failure text once UUIDs, timestamps and
   addresses are masked.
8. **Restart `api`**, then let the user check a real download.

---

## 6. Status by style (6 Oct 2026)

| Style | Layout correctness | Known before starting |
|---|---|---|
| Neat Stack | Done | Accepted known limit (§3a): 8 milestones + max subtitle + max dedication + scale 130 on 8x10 edged (26–42px short per milestone, names already at the floor). Styling deferred: fonts, weights, title colour and case, divider, polaroid border (preview 3.4%/11% vs print 6%/19%) |
| Alternating Tilt | Done (7 Oct) | See §7. Accepted (7 Oct): printed cards fill about 77% of a slot against the preview's 88%, because the shadow must stay clear of text. Deferred: spine width (2px in print, about 9px if scaled like the hearts) |
| Alternating Tilt (before 7 Oct, for the record) | was: not reviewed | Old text estimate (§3a); card overflow: its last card runs into the footer, and cards cover text in 23 renders now that locations print (§3b); unwrapped titles (§3c); descriptions omitted by design on both sides ("photo-led", §1); cards flat, no shadow (preview ±4°, `0 3px 10px` at 0.16); header left-aligned |
| Overlapping Cascade | Done (7 Oct) | See §9. Was 108 of 108 broken (cards 1.20–1.44× their slot, first card over the header rule and last at the footer in 107, unwrapped titles, square photo in a 1:1.15 card, preview clipping at 3). Accepted: the preview's text overlaps by 7px at the 55% floor with 8 maximum-length milestones at scale 1.3 (full descriptions in the preview; deferred description item). Legacy 1080×1080 and 1920×1080 still crowd at 8, as before |
| Dotted Branching | Done (12 Oct) | See §10. Was 106 of 108 broken (cards 1.03–1.38× their slot, the full-date chip wider than the gutter, unwrapped titles, square photo in a 1:1.12 card, preview clipping at 3). Accepted: legacy 1920×1080 and 1080×1080 targets still crowd with 8 or 5 milestones at scale 100–130 (see §10). Deferred styling: fonts, weights, date case and tracking, descriptions (omitted by design) |
| Horizontal Polaroids | Done (12 Oct) | See §11. Was 70 of 108 broken (all at 5 or 8 milestones: titles and dates one unwrapped line in a column 1/count of the page wide, shared estimate dividing the HEIGHT by the milestone count, flat square-photo cards, preview captions 24px apart, preview clipping the date at 3 milestones with text scale 1.3). Accepted: legacy `landscape-png`/`square-png` canvases are covered by the same limit as every style. Deferred styling: fonts, weights, date case |
| Horizontal Circles | Done (12 Oct) | See §11. Was 66 of 108 broken (same text failures) and its PREVIEW's axis ran across the top of the timeline instead of joining the tick tops. Accepted: on the 1080px legacy `landscape-png`, 130% text with long names still collides (1 of 18): the circle is not height-capped, as in the preview. Deferred styling: fonts, weights, label letter-spacing |

The subtitle and dedication fixes apply to all six (shared header). The
photo shape (landscape, portrait or square) was confirmed to have no effect
on Neat Stack's card placement. Header and footer
centring applies to the reviewed styles only (`_REVIEWED_CENTRED_LAYOUTS`).
All six styles are now reviewed.

---

## 7. Alternating Tilt (done 7 Oct 2026): what was different

Investigated against this guide before any code changed. 102 of 108
realistic renders were broken. Now 108 of 108 are clean with landscape,
portrait and square photos, and the worst header (8 milestones + 60-char
subtitle + scale 130) is clean in 12 of 12. Guarded by `AlternatingTiltTests`
plus the Alternating section of `composition-parity.test.ts`.

- **The preview was broken too, and was fixed first.** Its grid rows grew
  to fit fixed-width cards, and `.timeline` clips, so 3 milestones lost
  31px and 5 or 8 hid milestones 4-8 entirely. Now every row gets an equal
  share (`grid-auto-rows: minmax(0, 1fr)`). Each card sits in a size
  container (`.altPhotoCell`) and is `min(86cqw, (100cqh - 11px) / 1.0673)`
  wide, so its 4°-tilted outline fits the row. The text is fitted to its
  row by `FittedAlternatingTimeline` (`alternating-text-fit.tsx`), which
  measures in the browser and scales `--text-scale` down to the print's 55%
  floor. **Check the preview with 3, 5 and 8 milestones and long text**,
  not just the Studio's default 3. Building extra rows in the page (clone
  the composition's children) measures the real CSS when the Studio's form
  is awkward to drive.
- **The shared estimate overcounted here** (0.69-0.98 of the estimate,
  median 0.72), the opposite of Neat Stack: it budgets two description
  lines this photo-led layout never draws. Wrong either way, so it was
  replaced by a measured fit: `_fit_milestone_text` with
  `_alternating_block_height`. Expect a different error in each remaining
  layout. Measure, don't assume the direction.
- **Card overflow, same pattern as Neat Stack** (1.01-1.14× the slot).
  Fixed by fitting the whole card, its 4° tilt **and its shadow's visible
  extent** (2.25σ plus the offset) inside the slot. The shadow term matters:
  without it the last card's faint shadow reached "To be continued…" on the
  poster. That's why the printed cards fill about 77% of a slot where the
  preview's fill about 88%: the preview clips shadows at its edge, while the
  print has to keep them clear of text.
- **Styling matched in the same pass, by decision:**
  - tilt ±4°, symmetric;
  - shadow `0 3px 10px` at 0.16;
  - border 5/16px of a 151px photo;
  - the preview's heart path, sized 14px on a 540px poster;
  - text on the left half right-aligned toward the spine;
  - centred header and footer (`_REVIEWED_CENTRED_LAYOUTS`).
- **A docstring had claimed alignment the code never did.** Don't trust
  comments about appearance. Measure the preview and the print.

---

## 8. Studio milestone cap and the other previews (measured 7 Oct 2026)

**The Studio allows 3 to 8 milestones (raised 12 Oct 2026).** It allowed
exactly 3 from 20 Sep 2026 (`minEvents: 3, maxEvents: 3`; it had been 8 from 12
Sep). The backend always accepted 3-8 (`MAX_EVENTS` in `data.py`). The old
comment called the cap "a product decision rather than a technical limit"; the
owner recalled it as a workaround for overflow. `recommendedMin` and
`recommendedMax` sat above the cap and were read nowhere, so they were removed
with the comment. The cap was held until every style was fixed and verified at 8
(the table below), then the other surfaces were checked at 8 on 12 Oct (see
"Other surfaces at 8 milestones" at the end of this section).

**Every preview had to show every milestone before the cap could rise.**
Measured in the Studio by duplicating rows; "fully visible" counts photos entirely
inside the preview's clipped timeline box:

| Preview | 3 milestones | 5 milestones | 8 milestones |
|---|---|---|---|
| Neat Stack | fits | was 266px clipped, 2 of 5 fully visible; **fixed 7 Oct**: fits | was 767px clipped, 2 of 8; **fixed 7 Oct**: fits |
| Alternating Tilt | fits (fixed 7 Oct) | fits | fits |
| Overlapping Cascade | was 90px clipped (3rd card and location cut); **fixed 7 Oct**: fits | was 518px clipped, 2 of 5; **fixed 7 Oct**: fits | was 1,161px clipped, 2 of 8; **fixed 7 Oct**: fits |
| Dotted Branching | was 10px clipped (1 of 3 cards whole); **fixed 12 Oct**: fits | was 389px clipped, 1 of 5; **fixed 12 Oct**: fits | was 959px clipped, 1 of 8; **fixed 12 Oct**: fits |
| Horizontal Polaroids | no vertical clipping at normal size, but the date clipped by 10px at 3 with text scale 1.3; **fixed 12 Oct**: fits | same; **fixed** | same; **fixed** |
| Horizontal Circles | fits (axis in the wrong place; **fixed 12 Oct**) | same | same |

**Neat Stack's preview had Alternating Tilt's bug** (a column of
fixed-width cards growing past the box), so "closed" had covered only the
print. Fixed 7 Oct the same way as §7, and now closed on both sides:
- each card sits in an equal-height `.neatPhotoCell` size container;
- its width is `min(78cqw, (100cqh − 11px) / 1.0343)`;
- each `.neatEntry` row is equal, with its text centred and fitted;
- the tilts are selected on the cell (`.neatPhotoCell:nth-child(…)
  .neatPhoto`), because each card is now its cell's only child.

Measured live: 3, 5 and 8 milestones fit with 0px clipped, every card
inside its row. Known limit: 8 milestones of maximum-length text at scale
1.3 is 2px over even at the 55% floor, because the preview shows each
140-character description in full while the print cuts it to one line
there (that cutting is the deferred item). Overlapping Cascade was fixed
the same way on 7 Oct (§9), and Dotted Branching on 12 Oct (§10).

Overlapping Cascade re-measured 7 Oct in layout pixels (after the unit bug
below was found): 90, 518 and 1,161px, the same as the table, so those
figures were not inflated. At 3 milestones, the Studio's only allowed count
today, the third card is cut off and the third milestone's location line
is clipped (the entry ends at 581px in a 571px box). 2 of 5 and 2 of 8
cards are fully visible.

### Other surfaces at 8 milestones (checked 12 Oct 2026, before the cap rose)

| Surface | At 8 milestones |
|---|---|
| Framed mockup | Fine: it wraps whatever the artwork is; all 8 sit inside the frame. |
| Live page (Studio "Live experience" tab) | Fine: one full-screen section per milestone down a timeline (8 of them, 7,200px of scroll). |
| Digital HTML (`render_html`) | Fine: all 8 titles present. |
| AR card | Fine by design: it shows 3 milestones and "+ 5 more, when you scan". |
| Moment wallpapers | Fine: one per milestone per device, independent of the count. **Cost:** a pack renders 24 of them at 8 (3 devices x 8), against 9 at 3. Measured in memory with small photos, the whole set took 20.6s at 8 against 7.4s at 3, before any photo fetch from storage. |
| Story wallpaper | Works, and is a design change rather than a defect: the photographs become thin bands (about 1/8 of the usable height each on a phone or tablet) or eight narrow strips on a desktop, where three were thirds. |
| **AR scene** (the camera experience) | **Was broken from 5.** It spaced the photographs evenly down a 0.84 card but drew each 0.26 square, so they overlapped (0.05 at 5, 0.14 at 8: more than half a photograph) and later ones, which also rise further off the card, covered earlier ones. Fixed 12 Oct: `ar-timeline-layout.ts` (`milestonePhotoSize`) keeps 0.26 up to four milestones and shrinks to the spacing less a 0.02 gap above that. Verified by tests of the geometry, not in a camera session. |

### Pack download time at 8 milestones (12 Oct 2026): the real-R2 number is still missing

**Measured in isolation** (throwaway Postgres, mock storage, synthetic photos, a
full Complete-shaped pack through the real streaming path, one fresh process per
scenario). This is the CPU and memory cost only; it has no storage latency in it.

| Scenario | Wall | Of which moment wallpapers | Peak memory |
|---|---|---|---|
| 3 milestones | 22.3s | 8.8s | 414MB |
| 8 milestones, six layouts | 36.5-40.4s | about 23.5s | 384-409MB |
| 8 milestones, 1 vCPU | 38.7s | 23.9s | 390MB |
| 8 milestones, 0.75 vCPU | 52.5s | 32.4s | 391MB |
| 3 milestones, 0.75 vCPU | 30.5s | 12.1s | 402MB |

The worst CPU-only case is 44% of gunicorn's 120s. The layout does not matter.

**The photo cache cap is what bites at 8 milestones.** `asset_bytes_cache` holds
`ASSET_BYTES_CACHE_MAX_MB` (code default 64) per request. Eight photos totalling
40MB or 59MB were read from storage 8 times (once each). Eight photos totalling
73MB were read **97 times**: the cache filled, and the same photos went back to
R2, which is the original "3 photos read 18 times" problem triggered by the
milestone count. Uploads are re-encoded at quality 92 with no downscaling and the
upload limit is 10MB, so eight photos from a modern phone can pass 64MB. The owner
set `ASSET_BYTES_CACHE_MAX_MB=128` in `.env.docker` on 12 Oct (a container reads
that file only when it is created: `docker compose up -d --force-recreate api`,
not `restart`). **The VPS environment needs the same value**, and the code default
is still 64.

**Real-R2 timing is UNVERIFIED. Do not read the one failed run as a result.** The
run on 12 Oct (`backend/scripts/time_pack_download.py`, read-only against Supabase
and R2) failed at about 100s with `r2_read_budget_exhausted`, before any render
could use the cache. The owner then ran `backend/scripts/net_probe.py`, which
downloads from hosts that have nothing to do with Heartfolio (Cloudflare, Hetzner,
OVH): they stalled too, from the same network, so the cause was that network (the
company fiber, which had also broken Supabase DNS), not R2 and not the code. The
survey mode showed the customer's photos were ordinary (about the same median as
every customer's), so it was not the data either.

**To close it:** run `MODE=probe`, then the 3-milestone baseline, then the
8-milestone run from a network that passes `net_probe.py` (phone tethering), and
again on the VPS before go-live. The VPS run is the one that counts. What a pass
looks like: reads equal to distinct photos, wall well under 120s, no silence of
more than a few seconds. The scripts retry a dropped Supabase connection and
print what they read when a run fails.

### Measuring the preview: units and triggers (learned 7 Oct)

- **The Studio draws the poster scaled down (about 0.8) with a CSS
  transform.** `getBoundingClientRect()` returns the scaled size, while
  `offsetWidth`, `clientHeight` and `scrollHeight` return layout pixels.
  Never compare one kind with the other. The first `FittedTimeline` did,
  and shrank text about 20% too far. Some overflow figures reported on 7 Oct
  before this was found were inflated the same way.
- **The fit has to bisect.** Shrinking changes where lines wrap, so height
  isn't proportional to size, and one proportional step overshoots.
  `FittedTimeline` searches for the largest size that fits. It also
  re-fits when web fonts finish loading.
- **A hidden browser pane renders no frames, so `ResizeObserver` never
  fires there.** To test a fit after editing the page directly, trigger a
  real React render (switch typography and back), not a resize.

---

## 9. Overlapping Cascade (done 7 Oct 2026): what was different

Investigated against this guide first: 108 of 108 realistic print renders
broken, and the preview clipping at 3 milestones (the Studio's only count).
Now 108 of 108 clean with landscape, portrait and square photos, and the
fullest header (8 milestones + 60-character subtitle + scale 130) clean in
12 of 12. Guarded by `OverlappingCascadeTests`,
`OverlappingCascadeNamesGiveUpRoomOnlyWhenNeededTests` and the Cascade
section of `composition-parity.test.ts`.

- **The overlap is the design, so it is kept, and bounded.** Both sides
  divide the timeline into `count + photo_overlap` (0.22) equal slots with
  half the overlap spare at each end. A card's tilted outline may be 1.22
  slots tall, so it overlaps each neighbour by up to 0.11 of a slot and the
  first and last stay inside. In CSS this is flex rows plus two `flex: 0.11`
  spacers (`::before`/`::after`), with each card in a size-container cell:
  `--card-w: min(80cqw, (122cqh - 9.49px) / 1.1925)`.
- **The shadow is reserved at the ends only** (`_overlapping_stack_layout`). Counting
  it in every card, as Alternating Tilt does, left neighbours overlapping by
  5% of a slot against the preview's 22%; between cards the shadow just
  falls on the next card. Printed neighbours now overlap by 0.18–0.20 of a
  slot.
- **The code comment was false.** It said sizing width first gave
  "generous whitespace instead of overflow". Measured: overflow at every
  count. Don't trust comments about appearance (as in §7).
- **The photo is 1:1.15, as in the preview.** `_paste_photo(height=…)`
  crops the centre to that shape; the print used to paste a square photo into
  a card sized for 1:1.15, leaving a blank band.
- **The drift is one even diagonal**, 22% of the column end to end, narrowed
  so the widest tilted card stays in its column. The preview's fixed
  per-position table drifted one way only at 3 milestones; each card now gets
  `--cascade-offset` (−0.5 to 0.5) from `renderer.tsx`.
- **The names give up room on sold prints**, by the Neat Stack rule (§3a),
  which `_names_font_for_milestones` now applies to both layouts. The case:
  8 milestones, long names, scale 130 on the 8×10 edged print, 204px of text
  for 135px slots.
- **Two preview bugs outside the layout's own CSS.**
  - `.timeline`'s `gap: 14px` applied to the Cascade grid and pushed the text
    column, and the nodes, 14px past the print's (`gap: 0` now).
  - `FittedTimeline` measured with `scrollHeight`, which ignores padding and
    the part of a centred overflow above the box. It now measures the text's
    real extent (`neededHeight`). That lets `.cascadeEntry`'s half-date-line
    padding keep milestones apart as the print's separation does; before,
    fitted text touched the next milestone. Neat Stack and Alternating Tilt
    fit the same as before (0.708 / 0.909 / 0.657 against 0.717 / 0.912 /
    0.664).
- **Neat Stack's preview got the same padding (7 Oct).** At the fit limit
  its milestones touched (0px at 5 and 8 milestones of long text, 8 at 1.3).
  Now 10px or more. Text that already had room is pixel-identical, and cards
  and hearts do not move. The floor case (8 maximum-length milestones at
  1.3) is still −5px: the deferred description item, as in §8.
  **Alternating Tilt does not need it.** Consecutive milestones sit on
  opposite sides of the spine with a 2% row gap; measured, they never come
  closer than 10px. An earlier report said they touched; that was Neat
  Stack's measurement wrongly carried over.
- **Styling matched in the same pass, by decision:**
  - tilt ±2.5°;
  - shadow `0 3px 10px` at 0.16;
  - border 5/16px of a 163px photo;
  - card width 80% of the column, borders included;
  - an 8px node on the spine, level with the date line;
  - the spine and nodes at the preview's share of the page width (540px poster);
  - centred header and footer.
- **Accepted:**
  - At the 55% floor, 8 milestones with every field at its maximum at scale
    1.3 overlap by 7px in the preview, because the preview shows full
    140-character descriptions (the deferred description item).
  - The legacy 1080×1080 and 1920×1080 targets still crowd at 8 milestones,
    as they did before and as Neat Stack's do. 14 of 90 legacy renders have
    problems, down from 28.

---

## 10. Dotted Branching (done 12 Oct 2026): what was different

Investigated against this guide first (7 Oct): 106 of 108 realistic print
renders broken, and the preview clipping at 3 milestones. Now 108 of 108
clean with landscape, portrait and square photos, and the fullest header
(8 milestones + 60-character subtitle + scale 130) clean in 12 of 12.
Guarded by `DottedBranchingTests`,
`DottedBranchingNamesGiveUpRoomOnlyWhenNeededTests` and the Dotted section of
`composition-parity.test.ts`. Decisions (the owner's, 12 Oct): the whole
styling table except fonts and case; keep the FULL date; cards centred as in
the preview; the overlap model of Overlapping Cascade.

- **Same model as Cascade (§9).** `_overlapping_stack_layout(layout_id, ...)`
  is now shared: `count + 0.16` slots with half the overlap spare at each
  end, a tilted card of up to 1.16 slots, shadow room at the two ends only.
  Dotted has no drift. In CSS: flex rows, two `flex: 0.08` spacers, a
  size-container cell, `width: min(88cqw, (116cqh - 9.79px) / 1.1708)`.
- **The date chip is the first line of the milestone.** The full date
  ("Apr 12, 2019") is wider than the gutter between the cards and the text,
  so it could not sit centred on the spine; it did, 21px off it, over the
  cards' edge in the preview, and reached into both columns in the print
  (text column 51, photo column 16, over a card 17). It now starts on the
  spine and runs right above the title, with the page background behind it,
  so it still punches through the dotted line. Because it is in flow, the
  text fit counts it. In CSS: `margin-inline-start: calc(-4cqw - 4px)` (the 4%
  between the spine and the text column, plus its padding), which needs
  `container-type: inline-size` on `.layoutDotted`, and `position: relative`
  so it paints over the positioned line.
- **The shared estimate overcounted here** (text was 0.41–0.70 of it),
  because it budgets descriptions this photo-led layout never draws. Replaced
  by a measured fit (`_dotted_block_height`: chip line, wrapped title beside
  its heart, wrapped location).
- **Text starts at 52% of the width on both sides.** The print used 54.5% and
  the preview came out at 49% once `.timeline`'s 14px gap was added (it
  applies to this grid, as it did to Cascade's: `gap: 0` now).
- **Dash, line, heart and chip padding are CSS pixels on the 540px poster**
  and the print draws them at the same share of its width: dashes were 6px and
  8px on a 2480px page, the line 1px, the heart a 5px dot. The heart is the
  preview's SVG heart (`_draw_heart`), 11px, level with the title's first
  line.
- **Styling matched in the same pass:**
  - tilt ±3° and the `0 3px 9px` shadow at 0.15;
  - border 5/16px of a 158px photo and a 1:1.12 photograph (a square photo
    was pasted into a card sized for 1:1.12);
  - cards centred in the column (they were stepped 0/5/10% right);
  - centred header and footer;
  - the names heading gives up room on sold prints (`_names_font_for_milestones`
    now covers Neat Stack, Cascade and Dotted).
- **Accepted:** the legacy `*-png` targets that cannot hold a vertical stack
  still crowd, as Neat Stack's and Cascade's do: `landscape-png` (1920×1080)
  at 5 or 8 milestones with large text, and `square-png` at 8 with 130%
  text. These got a little worse for Dotted (date line now its own line:
  landscape-png 9 of 18 renders collide, was 5; square-png 1 of 18, was 0),
  while story-png, portrait-png and print-png went from 4/2/4 broken to 0.
  Not fixed, by the legacy decision (6 Oct).

---

## 11. Horizontal Polaroids and Horizontal Circles (done 12 Oct 2026)

Investigated separately (Polaroids: 70 of 108 print renders broken; Circles:
66 of 108), then fixed together because the grid, the column maths, the text
fit and the header are shared code, with separate tests, mutation checks,
renders and reports per style. Now 108 of 108 clean for each, with landscape,
portrait and square photos, and the fullest header (8 milestones + 60-character
subtitle + scale 130) clean in 12 of 12 for each. Guarded by
`HorizontalPolaroidsTests`, `HorizontalCirclesTests` (a shared harness
`_HorizontalHarness` only renders and records) and the two Horizontal sections
of `composition-parity.test.ts`. Decisions (the owner's): the whole styling
table except fonts and case; the print keeps its own text sizes with wrapping
and the 55% floor, never the preview's 7px (it would print as 2.5mm); fix the
preview's caption line spacing rather than copy it; 1:1.15 photographs and no
caption band; the Circles axis goes at the tick tops, as the print had it.

- **What was wrong in both prints.** A title and a date were each ONE line in
  a column 1/count of the page wide, so at 5 and 8 milestones they collided
  and ran off the page (66 titles wider than their column). The shared
  estimate divided the page HEIGHT by the milestone count although milestones
  are columns, which put the fonts at the 55% floor at 8 for no reason and left
  them full size where the width was the problem. Cards were flat, square, with
  a 30% caption band; Circles' axis was 1px and its ticks `18 * text scale`px
  on a 3000px page.
- **`_horizontal_plan` replaces the estimate.** Text wraps to its column (the
  caption to its card, the label and date to the column) and the plan shrinks
  it in steps to `text_fit_floor` until the tallest milestone fits the band AND
  no word is wider than its box (a word cannot wrap: a 40-character title's
  "weekend" is wider than a card at 8 milestones). A card is the column's 88%,
  or the widest card whose one-line milestone fits the band, at the UNSHRUNK
  size, like the preview, so it does not grow back as text shrinks. A circle is
  the column's 78%.
- **The Polaroid caption is drawn ON the card** (`_paste_polaroid(caption=...)`)
  before it is rotated, so it tilts with it as the preview's does, and the card
  is as tall as its caption needs (the bottom border IS the caption band).
- **Two preview bugs fixed.**
  - The caption was an inline span, so its lines took the card's 24px line
    height (a wrapped 40-character title's lines sat 24px apart, cards 148px
    tall at 8 milestones for 60px of text). It is `display: block` now, with
    its own 1.25 line height.
  - The card sized itself from its column alone, so at text scale 1.3 three
    milestones clipped the date by 10px. It is now `min(88%, ...cqh...)` with the
    timeline a size container, and `FittedTimeline` gained `fitTo="box"` (the
    horizontal milestones are columns, so the tallest milestone must fit the
    timeline's height).
  - Circles' `.hAxis` had no `top`: it ran across the TOP of the timeline,
    186px / 107px / 63px above the ticks at 3 / 5 / 8 milestones. Its top is now
    a circle's diameter (`0.78 * (100cqw - 2cqw * (count - 1)) / count`; the
    count is `--count`, set in `renderer.tsx`), within 0.5px of the tick tops at
    every count.
- **Styling matched in the same pass:**
  - tilt ±1.5° and the `0 2px 7px` shadow at 0.15;
  - cards 88% of their column, photograph 1:1.15, border and caption padding
    from the preview;
  - columns 2% of the box apart (the print used 12% of a column), everything
    top-aligned;
  - the Circles axis inset 2%, 85% line, and ticks and axis at the preview's
    share of the page, the label and date gaps from the preview;
  - centred header and footer.
- **Not matched, deliberately:** the preview's literal text sizes (7px and 8px
  on an 810px poster), label letter-spacing and fonts, weights and case (deferred
  for every style).
- **Accepted:**
  - Legacy `*-png` targets that cannot hold the layout: Circles on the 1080px
    `landscape-png` with 130% text and long names still collides (1 of 18; the
    circle is not height-capped, as in the preview). Every other legacy case went
    from 9-12 of 18 broken to 0, apart from that one.
  - Neither preview shows locations or descriptions, nor does either print.
