# Heartfolio — test plan for everything deployed

Every change from zips 02–16, one test each, in the order a customer would
hit them. Most are covered by a single Complete-pack purchase, so work top
to bottom rather than jumping around.

Do it all in **French** (`/fr`) — that is where the translation bugs show.

**Before starting, hard-reload (Ctrl+Shift+R).** Several of these failed in
earlier rounds only because the browser was running an old JavaScript
bundle, and it cost us hours.

**If something fails, send:**
1. What you saw on screen (paste the text)
2. The backend log lines from that moment (`docker compose logs api`)
3. The browser devtools **Network** tab entry — URL, status, response body
4. For anything visual, a screenshot

The Network tab matters more than it sounds. The live-page bug was found
only because its request was *missing* from that list.

---

## 0. Preconditions

| Check | How | Expected |
|---|---|---|
| Backend alive | open `/api/v1/health/` | ok |
| Database reachable | open `/api/v1/health/ready/` | ok |
| Catalog seeded | open `/api/v1/products/love-story-timeline/` | 6 packs, prices 1799 / 2199 / 1099 / 1499 / 2999 / 800 |
| Google key set | frontend build env `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | present |

If the prices still read 1800 / 1200 / 3000, the seed did not run — stop
and re-run `python seed_catalog.py --update-prices`.

If the Google key is missing, the location field renders **disabled** and
never errors. That looks exactly like "location is broken".

---

## 1. Preview tab labels — zip 02

Open `/fr/studio/love-story-timeline`. Look above the artwork.

**Pass:** Création · Encadré · Sur un écran · Expérience en direct
**Fail:** `preview.modes.flat` etc. → the bundle is stale, or 02 did not deploy

Click each tab. The fourth should show a scrollable live preview.

---

## 2. Location search — zip 16 (Google Places)

**This has never run against a real API. Test it carefully.**

In Milestone 1, clear the location field and type slowly.

- **2a. No dropdown on load.** Before typing anything, no suggestion list
  should be open under any milestone. (It used to auto-open under all
  three and look like pre-selected places.)
- **2b. Algerian POI.** Type the name of a café in Algiers you know exists
  in Google Maps. **This is the whole reason for the change.**
  **Pass:** it appears, with its address on a second line.
  **Fail:** nothing found → send the exact search text and the Network
  entry for `places:autocomplete`.
- **2c. Picking works.** Click a suggestion. The field should fill with
  "Name, Address". If it goes blank, `/retrieve` failed — send the
  Network entry for the `places/ChIJ...` request.
- **2d. Arabic.** Switch to `/ar` and search the same place. Names should
  come back in Arabic where Google has them.
- **2e. Disambiguation.** Type "Lisbon". You should get one useful result
  set, not four US Lisbons ahead of Portugal.

---

## 3. Upload error text — zip 02

Try to add a photo larger than the size limit.

**Pass (fr):** "… dépasse 10 Mo. Choisissez une image plus légère."
**Fail:** `media.tooLarge`

Then upload a normal photo — it should succeed. A 500 here means the
`expires_at` schema problem came back.

---

## 4. Price box hidden — zip 03

Fill in the milestones. Look at the left panel above the Continue button.

**Pass:** no price box at all before a pack is chosen
**Fail:** a box labelled "Total" with a price

Note the trade-off you accepted: no price is visible during editing.

---

## 5. Checkout packs — pre-existing + zip 03

Click Continue.

**Pass:** "Choisissez comment le recevoir" with **three** cards and a
wallpaper checkbox. Ticking it raises the price (17,99 → 21,99).
**Fail:** "Une erreur est survenue" → the pack fetch failed; send the
Network entry for `/products/love-story-timeline`.

Pick **Complete** (29,99) — it is the only pack that covers prints,
wallpapers and the live page in one purchase.

---

## 6. Paddle overlay — zip 12

Enter your email, continue to payment.

**Pass:** "Heartfolio — Love Story Timeline"
**Fail:** "loveStoryTimeline"

Also confirm the total matches what the card said. Django decides what is
displayed, Paddle decides what is charged — a mismatch means the Paddle
catalogue disagrees with your database.

"Quantity 1" is still expected. That is Paddle's own UI and unresolved.

---

## 7. Downloads — zip 04

Pay with a sandbox card. On the success screen:

**Pass:** ONE "Télécharger votre souvenir" button, plus a single row for
the live page. No list of eleven files.
**Fail:** the long list → 04 did not reach the deployed frontend

Download the zip and open it.

**Pass:** prints in both mountings, three device wallpapers, AND one
wallpaper per milestone per device (the moment wallpapers).
**Fail:** moment wallpapers missing → search the backend log for
`moment_wallpaper_failed` and send the traceback.

---

## 8. Live page — zips 11 + 15

On the order page, click "Ouvrir votre page en direct".

**Pass:** a new tab at `/fr/live/<uuid>` showing the keepsake
**Fail (a):** it downloads `gift.html` → 11 did not deploy
**Fail (b):** "This page wandered off" → 15 did not deploy, or the
backend rejected it. Check whether a request to `/api/v1/live/<id>/`
appears in the backend log **at all** — if it does not, the fetch never
left the frontend's server.

Open the same URL on your phone. It must work with no session.

---

## 9. Feedback — zips 07 + 08

**9a. Desktop, in-session.** On the order page you land on after paying,
give a rating and submit.
**Pass:** "Merci — cela nous aide vraiment." and a **201** in the log.

**9b. Phone, via magic link.** Open the emailed link on your phone, then
submit feedback there.
**Pass:** same.
**Fail:** this was still broken when we stopped. Send the
`POST /api/v1/feedback/` status **and response body** — the body names
the field that was rejected, which tells us which ownership path failed.

Both paths must work: desktop proves session ownership, phone proves the
token path.

---

## 10. Magic link — zip 07

Open the emailed link on a device that has never visited the site
(or a private window).

**Pass:** the order page loads with downloads
**Fail:** "Commande introuvable" → find the request in the backend log
and check the token in the URL:
- contains `%253A` → still double-encoded, 07 did not deploy
- contains `%3A` or `:` and still 404s → a real signature rejection, a
  different problem

---

## 11. Telegram — zip 14

You already saw `PAID`. The other two are untested:

- **Render failure:** only fires if a render breaks. If §7 showed all
  moment wallpapers, this correctly stays silent.
- **Upload failure:** fires on unexpected failures only — R2 down, not a
  file that is simply too large. §3's oversized photo should NOT alert.

If nothing ever arrives, check the log for
`telegram_alert_skipped_unconfigured`.

---

## 12. Arabic / RTL — pre-existing

Run the Studio once at `/ar`. Layout should mirror, and the preview tabs
should read التصميم · بإطار · على جهاز · التجربة التفاعلية.

---

## 13. Admin and ops — pre-existing

- `/admin/` loads **with CSS** (proves collectstatic worked)
- `/api/v1/ops/reports/` shows your test orders with real revenue

Numbers here have never been checked for correctness — the page rendering
does not mean the aggregation is right.

---

## Still unverified by anyone

- **The backend test suite has never run.** ~40 database-backed tests,
  covering code changed in 07, 08, 11, 12, 14. Run
  `python manage.py test` against a real Postgres. Highest-value task
  remaining.
- **`composition-parity.test.ts`** fails in my copy on a path that should
  resolve in your repo. Confirm `npm run test` passes for you — it is the
  only thing keeping the CSS and Pillow renderers in agreement.
- **Music presets** — reportedly a selector with no audio behind it.
  Never checked.
- **Where We Met** (`/fr/products/where-we-met`) — fully implemented in
  code, never opened. Worth one look.
