# Manual testing runbook

Written to be worked through in order — later sections assume earlier ones
passed. Each step says **what to look for**, because most of the failures in
this system are silent: a wrong render still produces a valid PNG, a broken
tracking target still loads a scene, a stale price still renders a page.

**Nothing here has been executed by me.** No database, no credentials, no
browser, no phone. Treat every checkbox as unverified.

---

## 0. Before anything else

```bash
docker compose up --build
docker compose exec api python manage.py migrate
docker compose exec api python manage.py createsuperuser
```

**Then the two things that gate everything:**

```bash
docker compose exec api python manage.py test
docker compose exec api python seed_catalog.py
```

Roughly 40 database-backed tests have never run — §7a's revenue
aggregations, §9's alert transitions, §21's lifecycle, §7c's review
queries. If any fail, stop: they are testing the correctness of numbers and
access rules, not cosmetics.

The seed script validates that every target in every pack is one a renderer
can actually produce. Read its output rather than skimming for a zero exit.

---

## 1. The Studio — creating a story

Open http://localhost:3000/en/create and start a Love Story Timeline.

| Check | What to look for |
|---|---|
| Story type selector | Four options: couple, family, parents, gift |
| Switch couple → family | Title changes to "Our Family Story" **only if you had not edited it**. Type your own title, switch again — it must be kept. |
| Names | A family accepts more than two; a couple exactly two |
| Milestones | Refuses fewer than 3; refuses more than 8 |
| Photo | Required on each milestone. A milestone without one blocks checkout, not typing. |
| Location | Optional, appears under the description |
| Description | Accepts up to 140 characters |

**Layouts.** Switch through all six. Look for:

- The four portrait ones should read as genuinely different. Neat Stack and
  Overlapping Cascade show the description; Alternating Tilt and Dotted
  Branching do not, and their photographs are larger because of it.
- The two horizontal ones should turn the preview landscape.
- **Switching away from a layout that hides descriptions and back must not
  lose what you wrote.**

**Preview modes.** The tabs above the preview: Artwork, Framed, On a device.

- Framed shows a mat and moulding.
- On a device shows phone/tablet/desktop with OS furniture drawn over it —
  a clock, a home indicator, a dock. **This is how you judge the safe
  zones.** If the clock lands on a face, the safe zone is wrong.
- The watermark must appear in **all three** modes. If it only shows on
  Artwork, the mockup is wrapping the wrong thing.

---

## 2. Media (§5)

| Check | Expected |
|---|---|
| Upload a photo | Accepted |
| Upload a >30s video | Refused, with the duration named |
| Upload a short video as a milestone video | Accepted |
| Rename a `.mp4` to `.m4a` and upload as audio | **Refused** — the file is probed, not trusted |
| Upload a voice note | Accepted |
| Upload background music | Accepted at story level, not per milestone |

**Verify the EXIF strip.** Upload a phone photo with location on, then
download it back from the order and inspect it:

```bash
exiftool downloaded.jpg | grep -i gps    # should return nothing
```

If GPS survives, re-encoding is not running and you are storing where your
customers live.

---

## 3. Checkout and delivery

Buy the Printable pack with Paddle sandbox.

| Check | Expected |
|---|---|
| Success view | Downloads visible, plus a "View your order" button |
| Order page | Payment confirmed, files listed by name — **never** raw ids like `print-a4-edged` |
| Download the pack | A zip |

**Open the zip and count.** Printable should contain **12 files**: six PNGs
and six PDFs — A4, Classic, Poster, each frameless and edged. Plus the
bonus folder.

| Check in the files | What to look for |
|---|---|
| Frameless vs edged | The edged version has a visible half-inch clear margin; the frameless runs to the edge |
| Open a PDF in a print shop's terms | Page size **is** the artwork — an A4 PDF is A4, a poster PDF is 12×18. Not everything on A4. |
| `bonus/how-to-print.pdf` | Real selectable text, covering both mounting methods |
| `bonus/thank-you.pdf` | ⚠️ **A placeholder.** Replace before launch. |
| Attribution | `theheartfolio.com` at the foot of each print, small and quiet, **inside** the frame margin on edged versions |

**Buy the Wallpaper pack.** With 5 milestones expect **18 files**: 3 story
wallpapers plus 15 memory wallpapers (5 milestones × 3 devices).

- Set a story wallpaper as your actual lock screen. **Does the clock land on
  anything?** This is the check the safe-zone numbers have never had.
- A memory wallpaper should be one photograph filling the screen with a
  caption in a gradient at the bottom — not a shrunken poster.

**Buy the Complete pack.** 10 items plus bonuses, and a live page link.

---

## 4. The Digital keepsake (§10)

From the order page, open the live link.

| Check | Expected |
|---|---|
| Opening | Names, title, duration in years/months/days — **not** minutes |
| Scroll slowly | Milestones fade and settle as they reach the middle |
| Tap a photo | Lightbox opens; tap anywhere closes it |
| Music control | Present only if you uploaded music, and **starts off** |
| Video/audio | Only on milestones that have them — no empty players |
| Ending | Dedication, closing line, Heartfolio colophon |

**Open it in a private window with no session.** It must still work — the
recipient has no account. Then change one character of the id: you should
get the same generic 404 as a made-up id.

---

## 5. AR (§21)

**This section will not fully pass yet** — see §7 below.

| Check | Expected |
|---|---|
| Buy an AR pack | Requires creating the pack first (see §7) |
| Order page | "Preparing your AR card…" with a percentage |
| When it finishes | "Your AR card is ready to print" |
| If it fails | A calm line about the first scan taking longer — **not** an error |
| Download the card | A5 PNG: three large photos, "+N more, when you scan", a QR |

**Print the card and scan it with a phone.** Scan the QR, allow the camera,
then **point the camera back at the card**. The timeline should draw itself
and photographs lift off the card.

⚠️ **This has never run on a device.** iOS Safari is the specific risk —
memory limits may kill the tab. Test iOS and Android separately.

---

## 6. Ops screens

All at `/api/v1/ops/`, behind the Django admin login.

| Screen | Check |
|---|---|
| `status/` | Five services. R2 and Paddle show **unknown** when unconfigured, not red |
| `lookup/` | Search by email or a **partial** order id |
| `reconcile/` | Search, see Paddle candidates, confirm one |
| `reports/` | Revenue, breakdowns, new vs returning, unpaid rate |

**The lookup screen's real test:** find a paid order and check it says "Paid
and delivered". Then, in the admin, delete its entitlements and search
again — it must say **"PAID — but nothing was delivered"** in red. That
condition is the entire reason the screen exists.

```bash
docker compose exec api python manage.py check_services --no-alerts
```

---

## 7. Things that will fail until you do them

These are not bugs. They are unfinished work.

1. **`heartfolio-card.mind` does not exist.** A shared-target AR card will
   load and track nothing. `tools/compile-shared-target/README.md`.
2. **No AR pack exists.** Create one in Django admin on Love Story Timeline
   with `ar-card` and/or `ar-screen`. The admin will accept them now.
3. **Prices are unchanged** while the packs grew — Printable 1 file → 6,
   Complete 6 → 10.
4. **`ogImage` is null**, so the Merchant Center feed cannot pass review.
5. **§18a's thank-you card is a placeholder.**
6. **Analytics are off** until `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` and
   `NEXT_PUBLIC_GA_ID` are set. Both are build-time — redeploy, not restart.
7. **`X-Content-Type-Options: nosniff`** must be set on the R2 bucket. It
   cannot come from Django. This is the mitigation that matters for
   probe-only video.
8. **French and Arabic are unreviewed.** I wrote all of it and I am not a
   native speaker of either.

---

## 8. Before real customers

- [ ] Tighten `THROTTLE_RATE_FEEDBACK_CREATE` and `THROTTLE_RATE_AR_ACCESS`
- [ ] Confirm `DJANGO_SETTINGS_MODULE=config.settings.production` in the production environment (the VPS, once it exists)
- [ ] Confirm `FRONTEND_URL` — it is baked into every emailed link and every
      printed QR, and a QR with the wrong host cannot be recalled
- [ ] One real reconciliation through `/ops/reconcile/`
- [ ] Consider moving the §12 order token from `?token=` to a path segment.
      It is a bearer credential and query strings land in browser history
      and `Referer` headers. The AR URL already avoids this; the order link
      does not.
