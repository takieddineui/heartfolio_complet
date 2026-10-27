# Heartfolio — Project State

> **Hosting note (updated):** this log was written while the backend ran on
> Railway and the frontend on Vercel. Neither is used any more: development
> is local Docker, and production is planned as a VPS running the same Docker
> setup (the database for the VPS is undecided). The Railway and Vercel
> mentions below — the `$PORT` incident, the memory and worker-count
> measurements "approximating Railway", the Vercel proxy-timeout notes — are
> **historical record** and are left as written.

Supersedes `IMPLEMENTATION-STATUS.md` (last updated August 31st, now stale
against nearly everything below). Organized by confidence level, not by
feature, because "is this actually verified" matters more than "does this
exist" for deciding what to do next.

**Everything below this point predates a large second phase of work — see
§0 at the very end of this file for what's happened since:** Song Poster
built end to end (all 8 themes, live page, Studio module), a site-wide
animation pass, the FastSpring-driven five-tier repricing now live in
production, Star Map deleted, and the local Docker environment reworked.
Read §0 first if you're picking this project back up.

---

## 1. Built AND verified in an automated sandbox

Real code, real tests actually executed, real `next build`/lint passes.
"Verified" here means: typechecks, passes its test suite, builds — it does
**not** mean confirmed in a real browser or against a real database (see
§3).

### Love Story Timeline — the product itself

- **Six visual compositions**, each implemented in parallel as CSS (live
  Studio preview) and Pillow (the actual rendered output), with a parity
  test suite asserting the two stay numerically identical: Neat Stack,
  Alternating Tilt, Overlapping Cascade, Dotted Branching, Horizontal
  Polaroid, Horizontal Circles (the last two are landscape).
- **Story types** (couple / family / parents / gift) with per-type default
  copy and duration phrasing ("N days together" reads as a mistake on a
  family history, so it's suppressed for that type).
- **Names**: 1–2 people (one limit for every story type, reduced from 6
  on 5 Oct 2026 — no existing project had more than two), joined with
  `&` only — **never** a translated word ("and"/"et"), in any locale. This was a real,
  reported bug; see §5 for the story.
- **Milestones**: 3–8 required, each with a photo (required), optional
  short video, optional voice note, and a Mapbox-backed structured
  location (§2 below) — not free text.
- **Background music**: a closed preset selection (5 entries including
  "No music"), not a free upload. **No actual audio files exist yet** —
  the mechanism is complete; the tracks are not. See
  `music-presets.ts`'s header for the exact constraint (instrumental, no
  vocals) whoever adds real files needs to follow.
- **Palette**: controls poster color treatment only — verified to have NO
  coupling to frame, typography, or layout (an earlier version had both;
  both were found and removed).
- **Frame and print format** are no longer customer choices — frame style
  is one fixed default for edged prints, and canvas size derives from the
  selected composition's own orientation.

### Commerce

- Five active `DeliveryPack`s, one disabled — see `PRODUCT-CATALOG.md` for
  the full pricing table. An audit of the entire purchase flow (pack
  selection → price → Paddle → fulfillment) found it already matched the
  intended "packs are the basis of purchase, not a calculated total"
  model; nothing needed changing there.
- **The order-access token moved from `?token=` to a URL path segment**
  (matching how the AR and Live experience links already worked). While
  making this change, two real routing bugs were found and — this
  matters — **proven** caught by deliberately reintroducing each bug,
  watching the new test fail, then restoring the fix and watching it
  pass:
  1. Within `commerce/urls.py`, a naive route ordering would have let the
     new generic token pattern swallow the literal `/pay/` and
     `/entitlements/` segments as if they were tokens — making checkout
     payment confirmation unreachable.
  2. **Across app boundaries**, at the project root: `commerce.urls` was
     included before `delivery.urls` at the same prefix, so commerce's
     token pattern also intercepted delivery's own download route.
     Fixed by reordering the includes.
  A third, smaller bug was found and fixed alongside: the emailed
  magic-link builder hardcoded English regardless of the order's actual
  locale.

### Media storage

- Photos are uploaded and stored permanently, immediately, as before —
  every pack needs them, so there's nothing to defer.
- **Video and audio are provisional**: uploaded immediately (so editing
  still works exactly as before) but tagged with an expiry timestamp. A
  paid order that actually needs them (Digital, AR, or Complete)
  "promotes" them to permanent at the moment payment confirms — read
  generically from the pack's `included_targets`, never from a pack slug,
  so it survives renames. A new scheduled command,
  `expire_provisional_assets`, deletes anything left provisional past its
  window (default 7 days). **This entire mechanism does nothing unless
  the scheduled job is actually configured to run** — see
  `DEPLOYMENT-GUIDE-DOCKER.md`'s scheduled-job section.

### Preview system

- Four preview modes: the main artwork, a framed-on-a-wall mockup
  (Printable pack), a phone/tablet/desktop mockup (Wallpapers pack), and a
  **real, interactive Live preview** — reusing the exact same component
  that renders the purchased `/live/<id>` page, fed directly from Studio
  state, with zero server round-trip. Only a product that opts into this
  (Love Story Timeline does; Where We Met Map doesn't) shows the fourth
  tab.
- **A real CSS layout bug was found and fixed** in the Framed/Device
  mockups: their wrapper divs had no explicit size, which broke the
  sizing chain the shared `ScaleToFit` component depends on, causing
  artwork to render at full intrinsic size instead of scaling down — the
  visual symptom was content appearing to "burst out" of the preview
  panel. **This fix has never been visually confirmed** — see §3.

### Two production bugs, root-caused and fixed

- `HOMEPAGE_FAQ_KEYS.map is not a function` on `/en` and `/fr`: a Server
  Component was importing a plain data array from a `"use client"`-marked
  file. Next's RSC compiler only preserves component references across
  that boundary, not arbitrary exports — the array literally wasn't the
  array on the server. Fixed by moving the shared data to a file with no
  `"use client"` directive. The **same search found a second instance**
  of this exact bug, quieter and worse: an inline anti-flash `<Script>`
  tag was silently rendering empty on every page load (no crash, just a
  theme flash before hydration) for the identical reason.
- A leaked i18n key (`fields.eventPhoto.label is required`) shown
  directly to customers: the shared validation-message resolver was
  interpolating a raw schema key instead of resolving it to text first.
  Fixed at the shared resolution point, which fixed every validation
  code that carries a label, not just the one that was reported.

---

## 2. Built but needs a decision or has an open question flagged in code

- **AR's future two-axis pricing question** (AR alone vs. AR+Wallpapers,
  crossed with an optional +$2.99 printable AR card) is explicitly
  unresolved and flagged as a future decision — not solved, not guessed
  at.
- **Complete does not include AR.** This was an explicit decision:
  changing that later requires asking first, not doing it silently when
  AR ships.

---

## 3. Genuinely unverified — needs something only a human has access to

Nothing below is "probably fine." Each of these has real, specific reasons
it couldn't be checked from an automated sandbox.

| What | Why it's unverified | What to actually do |
|---|---|---|
| **The shared AR `.mind` target** | Needs native build dependencies (Cairo/Pango) that only exist on a real machine | `tools/compile-shared-target/`, run locally |
| **AR tracking, once the target is compiled** | Needs a physical phone | Scan the printed card and confirm tracking actually works before AR ever goes live |
| **Revenue figures on the ops Reports screen** | `SalesAnalyticsTests` had no `setUp` at all, so every test in it errored the moment the suite was first genuinely run — the aggregation behind the reports page has never been checked by anything | Re-run the suite and confirm those tests now pass |

### Since closed — verified, and how

These were in the table above. They are listed here rather than deleted so
the claim can be challenged: each says what was actually done, not that
somebody felt confident.

| What | How it was verified |
|---|---|
| **Preview tab overflow** | Restructured into two tiers — device options now sit on their own row beneath "On a device" and appear only while it is selected. Confirmed in production in a real browser |
| **Mapbox location search** | Confirmed against a live token in production. Two real faults were found and fixed: a `types` filter that silently excluded streets, districts and regions, and a misreading of `language` (it is the RESPONSE language on Search Box, not the search language). The stored location name is now the customer's own typed text — Mapbox supplies coordinates only |
| **Every database-backed test** | The suite runs. 649 tests found, against local Postgres in Docker. The first real run surfaced 54 failures, almost all stale fixtures rather than broken code; see `CLAUDE.md` |
| **The Railway `$PORT` fix** | The 502 was not `$PORT` at all — gunicorn was listening on 8080 while the Railway domain's target port was set to 8000. Resolved by aligning them |
| **`seed_catalog.py`** | Run against the live Supabase database. `/api/v1/products/love-story-timeline/` now returns the intended five-pack state at 1799 / 2199 / 1099 / 1499 / 2999 |

---

## 4. Deliberately deferred, not forgotten

- **Real audio files** for the five music presets. Sources were
  identified and discussed (Pixabay Music, Chosic, ElevenLabs Music for
  AI-generated originals with clear commercial rights) but nothing was
  added — parked at explicit request to return to later.
- **Real product photography** for the Google Merchant Center feed.
  Google's policy rejects images with logos or promotional text — the
  existing Open Graph social-share card (which does carry both) was
  briefly, almost wired in as the feed image before catching that this
  wouldn't actually satisfy the requirement. The code comment documenting
  this blocker was corrected to say so plainly. No amount of further code
  work fixes this; it needs real photography.
- **AR itself.** No `DeliveryPack` row exists for it — deliberately, per
  repeated explicit instruction not to create one until the target is
  compiled and tested end-to-end.

---

## 5. Notable bugs found while doing something else

Worth knowing about because they show up in places you might not think to
look:

- **`seed_catalog.py` was badly stale.** It still described the *old*
  four-pack catalog (standalone wallpaper active, no combo packs, old
  prices) — the state from *before* the pricing/catalog rework, whose SQL
  was run by hand against the live database but never reflected back into
  this file. A fresh database seeded from it would have silently come up
  in a state the live database had already moved past. Fixed, and now has
  tests that validate the real `CATALOG` constant directly — asserting
  the exact expected prices, that the combo packs' targets are genuinely
  the union of their sources (not hand-typed), and that Complete excludes
  AR — rather than only testing the pricing-drift logic in isolation, which
  is all the previous tests did.
- **The names bug**, as originally reported ("`/en`, `/et` appearing in
  names"), turned out to be a garbled description of the translated
  "and"/"et" joiner used for three-plus names — confirmed directly by the
  person who reported it. It had already been fixed for an unrelated,
  explicit rule ("the separator is always `&`, never a translated word")
  before the connection to this specific report was made. **This reversed
  an earlier, deliberate fix** that avoided a Latin `&` sitting inside
  right-to-left Arabic text — that concern is real and was traded off
  explicitly against the newer, more literal rule; worth revisiting if it
  still matters.
- **A Merchant Center comment was actively misleading its own reader**
  before being corrected: it said the blocker was "every product's
  `ogImage` is null." Setting a real `ogImage` didn't fix anything,
  because the underlying image was still the same branded card Google's
  policy rejects — the comment now says that plainly.

---

## 0. Addendum — second phase of work, read this first

Everything above predates this section. This covers Song Poster's full
build, a site-wide animation pass, the FastSpring-driven repricing, Star
Map's deletion, and the local Docker/scripts rework. Same confidence-level
discipline as the rest of this file: what's actually verified vs. what's
built-but-unconfirmed.

### Built AND verified (real tests executed, real renders inspected)

**Song Poster — the whole product, not a skeleton.**
- **8 print/wallpaper themes**, each with a real Studio preview component
  and a matching Pillow composition: Player (real YouTube playback, real
  seeded waveform), Ledger, Ephemeris, Contact Sheet, Label, Award
  (landscape-only), Sleeve (landscape-only, curved SVG text rings drawn
  character-by-character in Pillow since it has no native curved-text
  primitive, six selectable palettes wired end to end frontend+backend),
  Mosaic. Every theme was actually rendered and visually inspected, not
  just typechecked — several real bugs were caught this way (a
  theme-registry sync gap that silently downgraded every Ledger order to
  Player before a customer ever saw it; a landscape print-orientation bug
  affecting Award/Sleeve; Sleeve's palette picker never reaching the
  Python renderer at all, so a customer's colour choice was cosmetic-only
  until fixed).
- **A real digital keepsake** (`song-live-keepsake.tsx` + `live_views.py`'s
  `_build_song_poster_live_payload`) — ceremonial opening, actual
  interactive playback and seek, independent of which print theme was
  purchased (mirrors Love Story Timeline's own "digital ≠ the print's
  geometry" principle). The `__live__` fulfillment mechanism was already
  fully product-agnostic before this — confirmed by tracing
  `grant_entitlements` directly — so no new backend logic was needed, only
  the catalog rows.
- **Photo URLs in the live payload are generated fresh per request**
  (`generate_asset_access_url`), not read from `project.data`'s own stored
  value — that stored value is a presigned, expiring URL (confirmed via
  `media-values.ts`'s documented lifecycle). Love Story Timeline's
  existing live page may have this same latent bug for milestone photos —
  flagged, not fixed, since it's shipped code outside what was asked.

**A site-wide animation pass** — live page opening (brand mark draws
itself in via `pathLength`, then the couple's/song's own data settles in;
skips entirely under reduced-motion, not just shortened), the ending
section (a continuous CSS-only spark loop, deliberately not
framer-motion, so it inherits the site's existing global reduced-motion
rule for free), the checkout success screen (a single ripple, reserved
for that one moment — pending/failed states stay calm on purpose), and
conditionally-visible Studio fields/theme axes now fade in/out instead of
popping (the exact bug Sleeve's own palette picker was hitting on every
theme switch until this was built).

**The five-tier FastSpring-driven catalog repricing** — Digital $15.99 /
Digital+Wallpapers $20.99 / Printable $22.99 / Printable+Wallpapers
$27.99 / Complete $39.99, identical structure for both Love Story
Timeline and Song Poster. Two new Song Poster packs created (`live`,
`digital-plus-wallpaper` — it had no digital pack at all before this).
Song Poster's `complete` pack gained `__live__` in its `included_targets`
(previously print+wallpaper only). **Confirmed against the real
production database, not just the seed file** — `seed_catalog.py
--update-prices` was actually run against Supabase and its output pasted
back for verification; every price and target list matches exactly.

**Star Map deleted outright**, not hidden — it had zero backend
footprint (no `Product` row, no renderer ever registered), so this was a
clean, one-directional frontend removal: `lib/products/registry.ts`,
translation blocks in all three locale files, and its now-dead rendering
branch in `keepsake-visual.tsx`. One real near-miss caught before it
shipped: a test used `.find(...)!` (non-null assertion) on Star Map's own
registry entry — deleting the entry would have made that a runtime
crash, not a failed assertion. Removed the test rather than patch around
it, since the pattern it demonstrated no longer has a real example left
in the registry.

**Local Docker environment reworked** to match production topology
(`web → api → Supabase`, not a local Postgres) — the local `db` service
gated behind `docker compose --profile test`, `api` no longer depends on
it, `scripts/test.bat` created to run backend tests against the isolated
local Postgres with an explicit `DATABASE_URL` override (never touching
`.env.docker`'s own Supabase URL), and cleanup that always runs whether
tests pass or fail. `frontend-heartfolio/Dockerfile` fixed — it was
passing `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` as a build arg, but the actual
code reads `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`; the location picker had
likely never worked in local Docker at all until this was caught and
fixed. `NEXT_PUBLIC_GA_ID` added as a build arg alongside it.

Confirmed at the very end of this whole phase of work: `npm ci` + full
`tsc --noEmit` + full `vitest run` against the actual uploaded archive
(not a working copy) — **449 tests passed, 0 failed**, all backend
Python files parse cleanly.

### Built but NOT independently confirmed by a real `docker compose` run

Everything in the "Local Docker environment reworked" paragraph above was
verified by static YAML/AST parsing and by the person actually running
`docker compose` commands and pasting real output back — but was never
run by the assistant directly, since no Docker daemon is available in
that environment. Worth a final manual pass if anything there seems off.

Ten operational `.bat` scripts (`start`, `stop`, `restart`, `status`,
`logs`, `health`, `doctor`, `rebuild`, `shell-api`, `shell-web`, plus the
`hf.bat` menu hub tying them together) exist in `scripts/` — built
outside any conversation with the assistant, reviewed for the first time
during this handoff audit. All were sound; one real gap was found and
fixed: `rebuild.bat` did a plain `docker compose build` + `up -d`, which
can silently reuse cached layers and not swap the running container —
exactly the failure mode that caused a real, reported "still seeing the
old logo and only one product after deploying" confusion during this
session. Now uses `--no-cache` and `--force-recreate`.

### Deliberately deferred, not forgotten

- **FastSpring integration itself.** Extensive analysis was done — the
  existing Paddle integration deliberately never uses a provider-side
  product catalog (a "non-catalog" charge, built fresh from
  `DeliveryPack.price_cents` at checkout time, identified purely via a
  passthrough `order.id`) — FastSpring's dashboard-driven Product Path
  model is a different shape, and no code for it exists yet. The
  ten FastSpring products were mapped to Heartfolio's internal packs and
  the dashboard field values were specified, but this was explicitly
  scoped as analysis-only, twice, and nothing beyond the internal catalog
  changes above was implemented.
- **Per-theme live pages for Song Poster, per-layout for Love Story
  Timeline.** Both currently have exactly ONE digital experience
  regardless of which print theme/layout was purchased — a deliberate
  choice, not an oversight, but explicitly flagged as a real future
  decision in both `song-live-keepsake.tsx`'s and `live-keepsake.tsx`'s
  own top comments, including what would actually need to change.
- **The Studio export panel still displays portrait dimensions for
  Award and Sleeve** even though the delivered file is now correctly
  landscape (fixed separately, earlier) — the panel's own display logic
  needs a Shell-level type change that was scoped out at the time.
- **Love Story Timeline's own `starting_price_cents`** was also found
  stale (still showing the old $10.99 after its packs were repriced) and
  has since been fixed to $15.99 — mentioned here only because it was
  found and fixed in the SAME pass as Song Poster's identical issue,
  worth knowing they were two separate fixes, not one.

### A real, unrelated security finding — still open

**A live GitHub Personal Access Token is committed in plaintext**, in
both `backend/push.bat` and `frontend-heartfolio/push.bat` (the same
token in both files). Found while reading those files for style
reference before writing `scripts/test.bat`; explicitly out of scope to
fix at the time (a different file, a different task), and it has not
been addressed since. This should be rotated and removed from both files
as its own, separate, urgent task — a committed credential doesn't stop
being live just because it wasn't this session's focus.

---

## Deferred until before launch

Recorded from a read-only audit of the shared production database (this
session) plus items already known but not yet centralized here. None of
this blocks day-to-day development; all of it blocks shipping.

**Payment processor — the actual launch blocker.** Both Paddle and
FastSpring have declined the Heartfolio account; nothing is currently
running on a real, approved processor. The FastSpring backend
integration is built and unit-tested, but has never been exercised
against a real FastSpring account, and the frontend checkout wiring for
it was never built. Nothing else in this list matters until this is
resolved.

**Credential in git history — launch-gating.** The Supabase database
password appeared in `backend/.env.docker`, which was tracked in the
`backend` repo and remains readable in its history. `backend/.env.docker`
is now untracked and ignored going forward, but the history itself was
not rewritten. Whether the password has been rotated is UNCONFIRMED. If
it has not been, it is still a live credential sitting in git history —
rotate it, and consider a history rewrite, before this repo is shared or
made public.

**Test data in the shared production database — plan drafted, not
executed.** 5 `provider="mock"` orders exist in the shared Supabase
database and R2 bucket, confirmed by a direct, read-only query against
the running container: `73a6a47b-5aa2-41e8-87db-8e4c22084a80`,
`bf1f6907-80f7-436f-b79a-9f5ba3e9b8b6`,
`95f8c7b8-0b51-41d7-890c-e134269299e5`,
`9051f85a-d5e5-40d6-8e4d-69b702e892aa`,
`0e5c76d1-6b89-497c-9784-d878300e1e4c` — plus their projects, payments,
entitlements, one feedback row, and 10 uploaded assets/R2 objects.
Cleanup plan (proposed, not run): export the affected rows outside the
repo first; verify none of the 10 asset ids are referenced by any other
project's data; delete in one transaction in FK-safe order (feedback →
entitlements → payments → orders → projects); delete the R2 objects via
the existing asset-delete helper only after that transaction commits.

**Paddle-provider orders — UNCONFIRMED, same launch-blocking category.**
13 Paddle payments / 11 paid orders exist. Probably all sandbox tests,
since Paddle never actually approved the account — but this has not been
confirmed order by order. Decide and clean before launch, so day-one
reports start from zero.

**Reports count test data as real revenue.**
`apps/commerce/analytics.py`'s `_paid()` filters only on order status —
no payment-provider filter anywhere in the file. Confirmed live: the 5
mock-provider orders above were 33.6% of currently-reported revenue, and
Paddle sandbox orders are counted the same way, for the same reason.
Proposed: exclude `provider="mock"` in `_paid()`. Open question, needs a
decision before implementing: whether to add a persisted
`livemode`-style flag on `Payment` instead of/alongside a provider-name
filter — a schema change, not done.

**Local Docker is not isolated from production.** It runs against the
same Supabase database and R2 bucket production uses, and has Telegram
alerting configured — a real (non-test) feedback alert fired from local
test data during this audit. Mock-provider payments do not trigger the
"order paid" alert or the order-confirmation email (confirmed by reading
the code paths), which is why the rest went unnoticed. Real hazard
beyond stray test rows: running `migrate` or `seed_catalog.py` from a
local Docker container changes the deployed backend's actual
schema/catalog, not a local copy. Proposed, not implemented:
`docker-compose.yml` overrides for `DATABASE_URL` (pointing at the local
`db` service), asset storage, and Telegram/email, plus a local database
init script.

**Download can 500 through the Next.js proxy under load — root cause has
two distinct, confirmed mechanisms, only one of which is fixed.**

- **Mechanism 1, fixed: idle-timeout.** `OrderPackDownloadView`
  (`apps/delivery/views.py`) builds the whole zip into a `BytesIO` and
  returns it as one `HttpResponse` once complete — zero bytes reach the
  proxy for the entire render (confirmed: a real 34.2s / 224MB render in
  an isolated stack produced no output at all until Django's own access
  log showed 200). Next's proxy (`rewrites()` to an external
  `BACKEND_ORIGIN`) defaults `experimental.proxyTimeout` to 30000ms —
  read directly from the shipped source, not assumed — so a render past
  ~30s tears the connection down first. **Fix applied**:
  `experimental.proxyTimeout: 120000` in `next.config.ts` (matches
  gunicorn's own `--timeout 120`, no point exceeding it). Needs a `web`
  image rebuild to take effect (it's baked into
  `required-server-files.json` at build time, confirmed by grepping the
  built image). **Proven**: rebuilt, then that same 34.2s/224MB render
  reached the browser as a clean 200 with the fix in place.
  Vercel's own external-rewrite limit is a *separate*, fixed 120s cap
  (`ROUTER_EXTERNAL_TARGET_ERROR`) that does not read
  `experimental.proxyTimeout` at all — confirmed via Vercel's docs and a
  Next.js maintainer discussion. Whether a long *streaming* response
  specifically is exempt from it (rather than just delayed) is
  unverified and needs an actual Vercel preview test.

- **Mechanism 2, confirmed, NOT fixed by the above: the single gunicorn
  worker gets OOM-killed mid-render.** Constrained an isolated
  `api` container to 512MB (Railway's documented plan) and rendered the
  same class of large archive: memory climbed from an ~88MB idle
  baseline to 384.9MB (75%), then gunicorn itself logged `Worker (pid:7)
  was sent SIGKILL! Perhaps out of memory?` at the exact same
  millisecond the web container logged `Failed to proxy .../download/
  Error: socket hang up (ECONNRESET)` — the identical customer-visible
  symptom, but from memory pressure, not an idle timeout, and it can
  fire well under 30s. `docker inspect` on the container itself shows
  `OOMKilled: true` even though the *container* never exits or restarts
  (`RestartCount: 0`) — only gunicorn's own child worker process dies
  and gunicorn's arbiter silently respawns it, invisible to
  container-level monitoring. **This means raising `proxyTimeout`
  further, or any timeout tuning, does nothing for this failure mode —
  it is a memory ceiling, not a clock.**

- **The single-worker-*queueing* theory specifically (a request that
  merely waits its turn behind a busy worker gets killed by the 30s idle
  timeout) was tested directly and did NOT reproduce.** Three concurrent
  uploads, artificially slowed to ~12s each via a temporary delay,
  serialized cleanly through one sync worker (12s / 24s / 36s
  completion) with `proxyTimeout` still at the old 30000 default — none
  reset, even though the third waited ~36s end to end. A single
  request slowed the same way past 30s on its own DID reset, confirming
  the test harness works — the failure is specifically about *queued*
  time, which does not appear to count against the idle clock the way a
  single slow response's own time does. This is also consistent with
  the real incident: the only timed instance (2026-09-28, ~07:45) created
  its project 1 second after the guest call — far too fast for a 30s
  queueing delay to have been in play — and the reported 3-for-3 failed
  uploads left zero trace in Django's own log, which a live-but-busy
  worker would still eventually produce and a killed-and-respawning one
  would not. Both point at mechanism 2 (OOM), not queueing.

- **FIXED (this session, follow-up measurement below): `get_pack_
  deliveries_for_order` is now a generator** (`apps/delivery/services.py`)
  and its docstring no longer claims "streamed" — it now accurately
  describes why laziness matters (one entitlement's render in flight at
  a time, not all nine held at once). `OrderPackDownloadView`
  (`apps/delivery/views.py`) now returns a real `StreamingHttpResponse`,
  fed by a new `_iter_pack_archive` generator and a small `_ZipChunkStream`
  file-like object that lets `zipfile.ZipFile`'s normal blocking writes
  be drained and yielded as chunks instead of accumulating in one
  buffer. The four category download views (Printable/Wallpaper/
  LiveCards/Bonuses) get the generator's memory benefit for free — they
  still build their own smaller `BytesIO` response, unchanged — since
  they share the same underlying function and only ever iterate it once.

## Download memory: measured, then bounded (this session)

Followed up on mechanism 2 above with an actual phase-by-phase
measurement, then a fix, in the same isolated 512MB-constrained stack
(local Postgres, mock storage — never Supabase, never `.env.docker`).
Realistic project throughout: 3 milestone photos, ~7MB/~7.7MP each,
Complete pack (9 print/wallpaper targets + digital + moment wallpapers
+ bonuses) — the same class of project mechanism 2 above was confirmed
against.

**Step 1 — where the peak actually came from**, instrumented with
`resource.getrusage(RUSAGE_SELF).ru_maxrss` sampled at each phase
boundary (temporary, removed after measuring), cross-checked against
`docker stats`:

- Process baseline (Django/gunicorn already loaded): ~164MB.
- End of the 9-target render phase (`get_pack_deliveries_for_order`,
  eager-list version, wall 11.05s): ~300MB — **not** a steady
  accumulation across targets. Two step jumps did almost all of it: the
  *first* render (+76MB, decoding all 3 source photos into raw bitmaps
  for the first time) and the two poster-sized targets (+55MB, +8MB,
  larger output canvases). Six of nine renders added no new peak at
  all — each one's transient cost stayed under a high-water mark a
  bigger target had already set.
- Writing those 9 renders' already-encoded bytes into the growing zip
  buffer (`BytesIO`, main loop + PDF wrappers): ~300MB → ~524MB. This
  phase, not the renders themselves, was the dominant contributor —
  the eager list held all 9 PNGs' bytes (~61MB combined) alive
  simultaneously *and* alongside a buffer that only ever grew.
- Moment wallpapers + bonuses (rendered and appended after the main
  loop, not separately instrumented but bounded by the surrounding
  samples): buffer 94MB → 227MB, RSS 524MB → 587MB — a second wave of
  rendering that the old code ran *after* it was already near the
  512MB ceiling.
- Final `getvalue()` copy: no *additional* RSS growth observed in this
  specific trace — `BytesIO`'s own prior over-allocation had apparently
  already touched enough pages to cover the copy. Real and worth
  removing regardless (it duplicates ~227MB of already-built archive
  for no reason), just not the proximate cause of *this* run's OOM —
  the buffer's own growth during assembly already was.
- Total wall time for the full render, CPU-limited to 0.75 vCPU
  (approximating Railway): **34.0s** — **86s of margin under gunicorn's
  `--timeout 120`, using about 28% of the budget.** Not close, for
  this project. Per gunicorn's docs that timeout covers total time
  handling the request, so streaming does not change this margin
  either way — it was never a timeout problem to begin with (see
  mechanism 2 above). Caveat, stated plainly rather than left implicit:
  this is one project's number, not a proven bound. The larger,
  30.7MP-photo project below failed via OOM in under a second, not via
  time, so there is no measurement here of a project large enough to
  actually threaten the 120s ceiling — only of one that threatens the
  memory ceiling instead. A pack with many more milestones (§4's
  three-to-eight range, all rendered sequentially now instead of
  however the eager version scheduled them) is the more plausible way
  wall time itself grows large; it has not been measured.
- At the hard 512MB limit specifically, the *old* code didn't reach
  `getvalue()` at all: gunicorn logged `Worker was sent SIGKILL!
  Perhaps out of memory?` at ~501MB, mid-way through the zip-writing
  phase, before wallpapers/bonuses even started.

**Step 2 — implemented, smallest change first**, guided by the above:

1. Render targets sequentially and drop each entry's reference
   (`del result`) as soon as its zip entry is written — the retained-
   bytes cost the measurement found (~61MB across 9 entries), not
   canvases specifically (those were already going out of scope and
   being collected; nothing pointed to them being retained).
2. Replaced `BytesIO` + `getvalue()` with a `StreamingHttpResponse`
   over `_iter_pack_archive`, a generator that renders one entitlement
   at a time via the now-lazy `get_pack_deliveries_for_order` and
   writes it straight into a draining `_ZipChunkStream`, yielding each
   chunk as it's produced. This removes the "whole archive resident
   twice" cost entirely and stops accumulating every entry's bytes.
3. Canvas memory (RGB vs. RGBA, a lower-peak render strategy) was
   **not** touched — Step 1 showed the zip-buffer/retained-bytes phase
   dominated, not canvas rendering itself, so this wasn't justified.
   If a future, much larger single canvas ever dominates again, RGB-
   instead-of-RGBA (where alpha is unused) and a tiled/lower-peak
   render path are the options to revisit, in that order.

**Before/after, same 512MB harness, same project:**

| | Before | After |
|---|---|---|
| Peak RSS (in-process, uncapped run) | ~587MB | not applicable — streamed, no comparable single peak sample point |
| Peak RSS (`docker stats`, hard 512MB limit) | OOM before finishing (last sample ~501MB) | **390MB / 512MB (76%)**, no OOM |
| Result at 512MB | `OOMKilled: true`, gunicorn respawns the worker mid-request | 200 OK, full archive, container stays up |
| Total wall time (0.75 vCPU, 1536MB, uncapped) | 34.0s | 34.0s (unchanged — same rendering work, just not re-buffered) |
| Archive size | 238,125,488 bytes | 238,126,051 bytes (differs only in embedded PDF creation timestamps and per-order QR tokens — see verification below) |

**How much bigger a project fits, before vs. after:** the exact
baseline project above (3×~7MB/~7.7MP photos) already exceeded 512MB
*before* the fix (died mid-request, never completed at that limit) and
fits comfortably *after* (76% of the limit, ~120MB of headroom). Pushed
further after the fix: 3 photos at ~30.7MP each (same byte size on
disk, ~8.4MB, via lower JPEG quality) still exceeds 512MB, but now dies
almost immediately — during the *first* render's photo decode/composite
step, not during zip assembly. This confirms Step 1's own finding:
streaming removed the zip-buffer/retained-bytes bottleneck, but did
**not** and could not touch the separate, smaller-magnitude ceiling
Step 1 already identified in per-render photo decoding — exactly the
"only if canvases still dominate" case Step 2 said to report rather
than implement.

**Stated plainly: streaming does not eliminate OOM risk for large real
customer photos.** It fixed the failure mode Step 1 measured as
dominant for a *realistic* pack (the zip buffer accumulating every
entry). It does nothing for a project whose SOURCE photos alone are
large enough that decoding and compositing them blows the memory
budget before a single zip entry is ever written — the 30.7MP case
above dies in under a second, streamed or not, because the failure
happens upstream of anything this fix touches. Options for that
separate ceiling, per Step 2's own instruction to report rather than
implement since canvases didn't dominate the *measured* case:

- **Downscale oversized source photos before render** — cap the
  decoded pixel dimensions to whatever the *largest* output target
  actually needs (the poster print, ~3600×5400 at 300 DPI) via
  Pillow's draft-mode JPEG decoding (`Image.draft()`, which can decode
  directly at a reduced size instead of full resolution then
  downscaling) before compositing. Directly addresses the measured
  cost (photo decode, not zip growth). Tradeoff: touches renderer code
  the "renderer output must not change" rule in this task kept off
  limits — needs its own byte/pixel-identical verification pass, and
  needs care that the cap is generous enough that no real print size
  loses quality (a poster sold at 300 DPI must not silently get
  downscaled to less than that).
- **Lower-peak colour mode** — RGB instead of RGBA where alpha is
  unused shaves ~25% off a decoded bitmap's memory (3 vs. 4 bytes per
  pixel). Cheap and safe, but modest: it doesn't change the fact that
  a high-enough-resolution source photo still exceeds the budget, just
  raises the bar slightly. Worth doing alongside another option, not
  instead of one.
- **A per-photo dimension cap at upload time, with a clear
  customer-facing message** — reject (or automatically re-encode down)
  an upload whose *pixel dimensions* exceed a sane bound, independent
  of its byte size (the existing `MAX_ASSET_SIZE_MB` check is a byte
  limit and does not catch this: my 30.7MP/8.4MB test file passed it
  easily). Simplest and most robust — moves the decision to upload
  time, when there is a customer to show a message to, instead of
  download time, when there is only an order to fail. Tradeoff: a
  cap has to be chosen conservatively enough to admit any real phone
  photo (12–48MP is normal and typically well-compressed) while still
  excluding the pathological case (very high resolution at low
  compression, e.g. a rescanned or re-saved image) — needs a real
  number backed by a measurement of decode cost at that resolution,
  not picked arbitrarily.

None of these three is implemented. The measured, shipped fix in this
task addresses the bottleneck Step 1 found to be dominant for a
realistic pack; it does not close every path to an OOM.

**Verification:**

- Entry-by-entry SHA-256 comparison, before vs. after code, same
  project: all **PNG** entries (the actual purchased renders — every
  print size, every wallpaper, every moment wallpaper) are
  **byte-identical**. The 11 entries that differ are exactly the ones
  expected to: `reportlab`-generated PDFs (thank-you card, printing
  advice, PDF wrappers) embed a creation timestamp and are non-
  deterministic *even calling the same function twice in one process*
  (confirmed directly: two calls to `render_thank_you_card()` produce
  different bytes, same length) — pre-existing, unrelated to this
  change. QR bonus cards differ because they encode a per-order access
  token, and the before/after runs necessarily used different orders.
  Archive validity confirmed with a real unzip (`Expand-Archive`) —
  extracts cleanly, all 29 entries.
- Mid-stream failure: handled explicitly. A failure rendering a
  *purchased* entitlement (the only case that's fatal, matching the old
  code's behavior of an uncaught 500) logs, fires the existing
  `send_alert` ops path, and re-raises **without** calling
  `archive.close()` — so no valid end-of-central-directory record is
  ever written, and the client's unzip and the browser's own download
  both report failure rather than silently accepting a smaller-than-
  paid-for file. PDF-wrapper/moment-wallpaper/bonus failures keep their
  pre-existing swallow-and-log behavior (a broken thank-you card still
  must not cost the customer their purchased files). Covered by a new
  test (`test_render_failure_after_bytes_already_sent_aborts_without_a_
  valid_archive`) that fails a render on the *second* of two targets
  and asserts the exception propagates out of `streaming_content`.
- Unknown `Content-Length`: the response genuinely has none (a new
  test asserts `has_header("Content-Length")` is `False`). Confirmed
  against a real browser, not just the Django test client: uploaded
  photos, created and paid an order, and downloaded the pack via
  `fetch()` + `response.blob()` (the same pattern `lib/api/delivery.ts`
  uses) in the isolated stack's actual browser — Django's own access
  log shows a clean `200` for the request. `response.blob()` reads a
  stream to completion regardless of whether a length was declared, so
  no frontend change was needed.
- Full backend suite, before vs. after: identical set of 24
  pre-existing failures (byte-for-byte identical FAIL/ERROR list,
  confirmed via `git stash`), none newly introduced, none fixed by this
  change. Four existing `OrderPackDownloadAPITests` had to be updated
  for the new response type (`response.content` doesn't exist on a
  `StreamingHttpResponse` — Django raises rather than buffering it
  silently; switched to `b"".join(response.streaming_content)`, and
  moved that read inside each test's `patch.dict(...)` block now that
  rendering is lazy and only actually happens once something reads the
  stream). Two new tests added for the streaming/mid-stream-failure
  paths described above.

**Also report-only** (a different lever, concurrency rather than
memory): `gthread` workers would let one slow render stop blocking
*other* requests on the same worker process, but do not by themselves
lower any single render's peak memory — only streaming did that (same
conclusion the concurrency note below already reached, now with a
direct measurement behind it rather than just reasoning).

- **Concurrency/memory implications for the Railway deployment.**
  Dockerfile defaults: `--workers ${GUNICORN_WORKERS:-1}` (1 unless
  overridden), no `--worker-class` set (gunicorn default: `sync`),
  `--timeout 120` (worker silence kill, unrelated to connections),
  no `--keep-alive` set (gunicorn default 2s — moot for the Next proxy
  path specifically, since it sends `Connection: close` on every
  proxied request, confirmed from `http-proxy`'s own source, ruling out
  a stale-keep-alive-reuse theory considered earlier for the upload
  resets). **Railway's actual current `GUNICORN_WORKERS` value is
  unknown from here — it's a dashboard variable, not in this repo, and
  must be checked directly.** Measured memory cost of one worker
  rendering a large archive: ~88MB idle → 384.9MB peak (before an OOM
  kill) for a 3-milestone, 3-large-photo Complete pack against a 512MB
  cap — a bigger real project would hit the ceiling at an even smaller
  fraction of margin. Each additional gunicorn *worker* is a full
  separate process (its own Django/Pillow copy plus its own render
  buffer if it's also serving a big render) — on a 0.5GB plan, adding
  workers before fixing the buffering multiplies the exact risk that's
  already causing OOMs today. Threads (`gthread`) share one process's
  memory instead, so they're a safer way to stop one slow request from
  blocking all others, but they do not by themselves shrink a single
  render's peak memory — only streaming does that, and streaming is now
  done (see the measurement above: 390MB/512MB peak, down from an OOM,
  on the identical project). Ordering: `gthread` threads are the next
  lever worth considering for general concurrency, then
  treat added workers as needing a memory-plan increase to go with them,
  not a free lever on the current plan.

**Pre-existing test failures.** 24 tests, all in `apps.delivery`,
`tests_ar` and the delivery renderer code, have failed in every
full-suite run across several sessions — the identical set each time,
none of them touching `apps.commerce`. Nobody has investigated them; the
delivery-side ones in particular deserve a real look. One is a
test-isolation bug, not a real product bug:
`test_r2_backend_with_missing_credentials_fails_loudly` doesn't set
`PAYMENT_PROVIDER` itself, so it inherits whatever the ambient
environment has (`mock`, in local Docker) — hits production settings'
own "PAYMENT_PROVIDER=mock is not permitted" check first, and never
reaches the R2-configuration check it's actually named for.

**Build environment.** The `web` Docker image is built on
`node:24-slim` in every stage (27 Oct 2026; it was `node:20-slim`, below
what the dependencies declare, and `npm ci` failed once the lockfile was
written by the host's newer npm). Regenerate `package-lock.json` only with
the image's own npm (CLAUDE.md). Separately: repeated, intermittent network failures from
inside Docker were seen during local sessions — PyPI, Supabase DNS
resolution, R2 reads, and proxy socket hang-ups — none reproducible on
demand; a direct R2 endpoint check succeeded cleanly immediately
afterward each time.

**Merchant Center feed and the product page have drifted — needs a
fresh check before relying on this line.** As of the last time this was
looked at, the feed had dropped the standalone wallpaper item and gained
the two combo-pack tiers the product page shows; unconfirmed whether
that's still accurate.

**Love Story Timeline — artwork preview clipping at high milestone
counts.** Suspected in three layouts: Alternating Tilt, Overlapping
Cascade, Dotted Branching. Working theory, not confirmed: each one runs
out of vertical room as the milestone count increases — Alternating
Tilt's own code comment says it "needs room per milestone," which is why
its ideal range (`idealMin: 3, idealMax: 5`) sits at the low end of what
the product allows; the other two layouts are suspected for the same
reason but don't carry that same comment. Status: unconfirmed and
unresolved — screenshots of the actual clipping are still needed. Open
question: whether this is a preview-only rendering issue or also affects
the real exported file.

**Song Poster — two unconfirmed items.**
- The Studio module may have no `packs.*` translation copy, meaning
  checkout could show raw translation keys instead of pack names — not
  confirmed.
- No frontend code calls the YouTube-link validation endpoint (`POST
  /youtube/validate/`), even though the backend side is fully built —
  meaning "Continue" may never enable for a real customer. Confirmed by
  a full-source search finding zero call sites; not yet confirmed by
  driving the actual Studio UI end to end.

---

## 2026-09-30 — Love Story Timeline's voice note: investigated, two real bugs found and fixed, one confirmed still open

Started as an investigation of the milestone "voice note" field (Love
Story Timeline's §5 optional recording), requested because the UI was
showing literal untranslated strings. Grew into finding that the feature
had never actually worked, end to end, for any customer.

### Built AND verified

**Translation lookup bug (fixed).** `field-inputs.tsx` called
`resolveShellText("media.record"/"media.recordUnavailable", locale)`,
but that resolver only ever reads `SHELL_CHECKOUT_MESSAGES` — a
dictionary with no `media.*` keys at all. The real translations already
existed, correctly, in all three locales, but in `SHELL_VALIDATION_
MESSAGES`, a separate dictionary only `resolveValidationMessage` read
(and that function takes a `ValidationError` object, not a bare UI-label
key, so it couldn't be reused directly either). Fixed by adding a new
`resolveShellValidationText` resolver mirroring the same locale → English
→ raw-key fallback contract, reading the correct dictionary. Confirmed
live in English and French (clicking Record with no mic permission
produced the real translated error text, not the raw key).

**The "upload a recording" fallback was removed** (recording-only, per
explicit instruction) — but this exposed a real UX gap: a browser with no
`MediaRecorder`/`getUserMedia` support (or an insecure context) would now
show a completely empty, non-interactive voice-note field with the
fallback gone. Added a static "not supported in this browser" message
(new `media.recordingNotSupported` key, all three locales) for exactly
that case.

**Milestone audio/video never actually played on the live page (fixed).**
`_build_ar_payload` (`apps/delivery/ar_views.py`) sent the milestone's
bare `audio_asset_id`/`video_asset_id` UUID as the payload's `media.
milestones[].audio`/`.video`, on a code comment promising "the client
resolves those through the same ownership-checked path as everything
else." No such client-side resolution path existed anywhere in either
repo — `live-keepsake.tsx` and `ar-scene.tsx` both assigned that raw UUID
straight to an `<audio>`/`<video>` element's `src`, which a browser
cannot load anything from. A customer's recorded voice note was captured,
uploaded, and correctly promoted to permanent storage at payment — it
just had nowhere to play from. Fixed by adding `_resolve_milestone_asset_
url()`, mirroring the exact `get_asset_for_customer` + `generate_asset_
access_url` pattern `_build_song_poster_live_payload` already used
successfully for its own photo (same file). Both `/live/<id>` (Love Story
Timeline's own dispatch) and `/ar/<id>` share this builder, so both got
the fix from one change.
- 5 new backend tests (`MilestoneMediaResolutionTests`, `apps/delivery/
  tests.py`) hit the real HTTP endpoints and assert the resolved value
  contains the asset's actual storage key rather than the bare id,
  including the cross-customer case (a foreign asset id resolves to
  `null`, not a leak) and confirming both routes independently.
- Full backend suite re-run before vs. after via `git stash`: **identical
  24 pre-existing failures on both sides, zero newly introduced** (see
  the inventory below — one of those 24 has since been fixed too).

**A second, independent bug found while doing the end-to-end
verification below, not by request.** The frontend's own client-side
file-type gate — `ALLOWED_ASSET_MIME_TYPES` in `lib/api/assets.ts` —
listed only the three image MIME types. Every recorded voice note (and
the still-flagged-off video field) was silently rejected client-side
("isn't a supported format. Use JPG, PNG or WebP.") **before the
recording ever reached the backend**, which has accepted audio/video
since §5 shipped. This means the feature had never worked for any
customer, independent of the URL-resolution bug above. Its own regression
test (`"accepts every format the backend does"`, `media-values.test.ts`)
only ever tested the 3 image types, so the drift between the test's title
and its actual coverage went undetected. Fixed: the allowlist now mirrors
the backend's real 11-type list (`config/settings/base.py`'s own
`ALLOWED_ASSET_MIME_TYPES`); also fixed a companion bug where the flat
10MB image-size ceiling was being applied to audio/video too, instead of
the backend's real 50MB media ceiling (`MAX_MEDIA_SIZE_MB`).
- `tsc --noEmit`, `eslint`, full `vitest run` (474 passed / 24 skipped,
  +1 new test), `next build` — all clean.

### Confirmed live, in a real browser, deliberately isolated from production

A full checkout was actually driven through the real Studio UI — not
just asserted in a test — but **not** against the real Railway/Supabase/
R2 backend: `docker-compose.yml`'s own comments warn that a normal `api`
run points at the live Supabase database, and a live checkout there would
write real order/asset rows into production. Instead: an isolated backend
(throwaway local Postgres, `ASSET_STORAGE_BACKEND=mock`, `PAYMENT_
PROVIDER=mock`, freshly migrated and seeded), frontend dev server pointed
at it via a temporary `.env.local` (deleted afterward). No real
microphone exists in this environment, so `navigator.mediaDevices.
getUserMedia` was shimmed to return a genuine `MediaStream` synthesized
from a Web Audio API oscillator — the real `MediaRecorder`/`handleFiles`/
upload code ran unmodified against real audio bytes, through the actual
Record button. Filled 3 required photo uploads, recorded a milestone
voice note, completed checkout with the mock payment provider ("Payment
successful"), and opened the resulting `/live/<id>` page.

**Confirmed:** the live page's `<audio>` element's `src` is the asset's
real resolved storage reference (`mock://assets/assets/<uuid>/audio.
m4a`), not the bare UUID. Backend access logs show a genuine `POST /api/
v1/assets/` (`201`) for the recording and a `media_assets_promoted` log
line at payment. All isolated infrastructure was torn down afterward
(containers stopped, `.env.local` deleted); `git status` in both repos
shows only the intended source files changed.

**What this does NOT prove:** that the URL is actually fetchable.
`mock://` is not a real scheme, and `MockAssetStorage`'s in-memory object
store is per-process, so it can't be inspected from outside the one
gunicorn worker that served the request. In production this resolves via
`R2Storage.generate_access_url` — the exact same, unmodified function
Song Poster's own live photo already relies on successfully today. High
confidence by code reuse, not independently observed against real R2.

### AR — the backend fix is directly tested; the frontend/browser side is not

`_build_ar_payload` is shared by both routes, and a dedicated test
(`test_the_ar_route_resolves_the_same_media_the_live_route_does`) hits
the real `/api/v1/ar/<id>/` endpoint and asserts the same correct
resolution — so AR's own payload is directly tested, not just assumed
to behave like Live's by resemblance. **What was not done:** no real
checkout ever produced an AR entitlement, `/ar/<arId>` was never opened
in a browser, and `ar-scene.tsx`'s own `attachMedia` — which sets
`element.src` from the identical `entry.audio ?? entry.video` pattern
`live-keepsake.tsx` uses, and which *was* proven live above — was never
independently exercised. This sits on top of AR's pre-existing, larger
unverified status already in §3 above: no physical device scan has ever
happened for this project at all.

### Pre-existing backend test failures — full inventory taken, mostly left alone

The "Pre-existing test failures" note earlier in this file flagged 24
failing tests and asked for a real look. This session did it: full
tracebacks read for every one, each re-verified individually. 22 of the
24 are confidently just-stale — evidence below, not a guess, for each
category:

- **10** — stale `Project.data` fixtures missing `version`/
  `themeSelections`, tripping the database's own `ck_projects_data_has_
  required_keys` constraint before the code under test is ever reached
  (`LiveExperienceDispatchTests` ×3, `tests_ar.ARLifecycleTests` ×5,
  `song_poster.tests.RendererTests` ×2).
- **3** — stale single-event fixtures (`"events": [{...one event...}]`)
  violating §4's later 3–8 minimum (`love_story_timeline`'s
  `DigitalRenderingTests`, `SecurityTests`, and `apps/delivery/tests.py`'s
  `GeneratedOutputNeverReachesR2Tests`).
- **2** — fragile source-string assertions (literally `assertIn("kind=
  kind", source)`) checking exact phrasing from before an already-
  completed, correctly-working refactor (`tests_ar.
  SharedExperienceAccessTests`, both tests).
- **3** — renderer-registry "which slug represents unregistered" drift:
  each test's own comment admits this has happened before (first with
  `heart-map`, now with `song-poster`) — both slugs have since gained
  real renderers. A sibling test in the same class, using a genuinely
  fake slug, still passes — confirming `registry.py`'s actual fallback
  logic is correct and this is purely fixture drift.
- **1** — a hardcoded pre-§10 short-link URL scheme
  (`EntitlementDownloadAPITests`; matches the deliberate hosted-live-page
  redesign already documented elsewhere in this file).
- **1** — the exact settings-check-ordering gap already noted in this
  file's own earlier "Pre-existing test failures" paragraph
  (`ProductionSettingsLoadingTests`) — not a deployment risk.
- **1** — an old `MIN_EVENTS` assertion, same §4 change as the row above
  (`DataValidationTests`).

**2 genuinely uncertain, then root-caused on request:**
`OrderPackDownloadAPITests` — both assert an archive contains only the
purchased pack, but a `bonus/thank-you.pdf` shows up. Traced to
`apps/delivery/bonuses.py`'s `bonus_targets_for_order()`, which hardcodes
the thank-you card for "every purchase, every pack" (§18a) — the call
site in `OrderPackDownloadView` has its own comment saying so directly.
**Deliberate, not a leak.** The two tests simply predate the bonus
feature being added to the whole-pack download. Left unfixed per
instruction, now confidently just-stale rather than uncertain.

**1 likely-real, low-severity, not fixed:** `DeliveryQueryBudgetTests` —
6 queries where ≤3 was expected, with 3 literally duplicate `SELECT
assets...` queries shown in the failure output. Looks like a genuine,
minor N+1 regression, not a stale assertion. Not investigated further.

**1 fixed on request, standalone (not part of any batch):**
`love_story_timeline.tests.SecurityTests.test_photo_belonging_to_
another_customer_cannot_be_rendered` — same single-event staleness as
the row-2 group above, but pulled out and fixed on its own because it's
a security regression test ("a stranger's photo asset must not render")
that was silently not running its own check. Before fixing it, confirmed
the same ownership boundary already has real, independently-passing
coverage elsewhere: `where_we_met_map.tests.SecurityTests` (identical
HTTP-level path — `EntitlementDownloadView` → renderer →
`get_asset_for_customer` — different product) and `song_poster.tests.
PngRenderingTests` (a direct unit-level call whose own docstring cites
this exact Love Story Timeline test as its origin); both re-run and
passing. Fixed anyway, for direct same-product coverage: the fixture now
uses the existing `values_with_real_photos` helper so the other two
milestones carry real photos owned by the correct customer, and only the
milestone under test points at the stranger's asset — so the render
genuinely reaches the ownership rejection instead of failing earlier on
the event-count rule. Re-ran the full `love_story_timeline` test file
after: 105 tests, only the 3 already-known, untouched failures from the
rows above remain — no regressions. **The other 9 tests in the stale-
fixture categories were deliberately left alone**, per instruction, for
a future scheduled batch pass — so the count of open pre-existing
failures is now **23, not 24.**


---

## 2026-10-04 — Freemius Printable/Complete checkout, download timeouts, and one open data problem

### KNOWN OPEN ITEM — two real paid orders cannot be rendered or delivered

**Needs separate investigation. Not fixed, deliberately, and unrelated to the
Freemius or download/timeout work below.**

| Order | Created | Pack |
|---|---|---|
| `9051f85a-d5e5-40d6-8e4d-69b702e892aa` | 2026-09-28 | `printable` |
| `95f8c7b8-0b51-41d7-890c-e134269299e5` | 2026-09-28 | `printable` |

Both are `paid`, both belong to `love-story-timeline`, and in both the project
holds 3 events but **events 0 and 1 have no photo `assetId`**. The renderer's
validation rejects them (`events[0].photo is required and must include a
non-empty string 'assetId'`, same for `events[1]`), so every render path —
pack zip, category zips, single-file download — fails with
`LoveStoryTimelineInvalidData` before any photo is read. A customer who opens
either order's page and presses a download button gets an error, not a file.

- Found by accident: a read-only survey of photos-per-order, run to pick test
  orders for the prefetch timing. Of the 28 paid orders that have a project,
  these are the only two in that state; every other one has 3+ photos.
- **How the data got this way is not known.** Nothing was changed to either
  order or its project; `themeSelections` is intact and the rest of the project
  looks normal. A guess would be the earlier period when a `blob:` photo URL
  could be saved in place of a durable `assetId` (see the live-page photo fix),
  but that is a hypothesis, not something checked.
- To investigate: how an order reached `paid` with unrenderable project data
  (is there a gap between what Studio lets a customer pay for and what the
  renderer accepts?), whether the missing photos can be recovered from the
  `Asset` rows, and what, if anything, these two customers should be offered.

### Download / timeout work — what was found and changed

**Symptom:** the first download of a paid Printable pack saved a zip Windows
called invalid; retrying the same download worked. **Cause:** nothing is
generated ahead of time — each zip is rendered inside the request that serves
it — and that render was exceeding gunicorn's 120s worker timeout. The
whole-pack route streams, so by the time the worker was killed the 200 and part
of the body were already sent, the browser saved the truncated bytes, and the
file had no central directory. Provider-independent: Paddle orders take the
same path. Timed against a real paid order, ~90% of the render was waiting on
R2 (a Printable pack read 3 distinct photos 18 times; single reads
occasionally took 17-87s).

**Changed** (all tunable by env var, listed commented-out in both `.example`
files):

- `apps/assets/services.py`: per-request photo cache (`asset_bytes_cache`) —
  each photo is read from R2 once per download, not once per rendered file;
  and `prefetch_asset_bytes`, which fetches an order's distinct photos
  concurrently (only the R2 read runs in threads; all ORM access stays on the
  request thread). `apps/delivery/photo_prefetch.py` finds the photo ids.
- `apps/assets/storage.py`: R2 client with connect/read timeouts and boto
  retries; one shared client instead of a new client + TLS handshake per read;
  body reads retried on timeout/reset/short read, with a per-attempt deadline
  checked every 16KB (a larger chunk let a slow trickle overshoot the deadline
  30x — found by a real-socket test); and a **request-level read budget (90s)**
  shared by every read in a request, because three 45s attempts on one photo
  is more than the 120s worker limit (seen for real when R2 degraded).
- `apps/delivery/product_renderers/love_story_timeline/png_renderer.py`: the
  three full-screen saves use `compress_level=6` instead of `optimize=True`.
  Measured on a real 4-milestone Complete order: 62s of ~100s was PIL's PNG
  encoder; now ~9s. Decoded pixels identical on all 21 comparable PNGs; PNG
  entries ~4.5% larger. **`ar_card.py` and `generic_card.py` still use
  `optimize=True`** — not measured, did not appear in the profile, left alone.
- Frontend (`lib/zip-integrity.ts`, `lib/api/delivery.ts`,
  `order-downloads.tsx`): a zip is only saved if it ends in a valid
  end-of-central-directory record that matches the bytes before it; otherwise
  "That download didn't finish, so nothing was saved. Please try again." (en/fr/ar).
- Freemius: `FREEMIUS_PLAN_MAPPING` now maps Digital (69404), Printable
  (70517) and Complete (70518); the two wallpaper-combo packs are deliberately
  unmapped and the "Add wallpapers" add-on is hidden by
  `SHOW_WALLPAPER_ADDON = false` in `lib/feature-flags.ts`.

**Measured (read-only, real orders, real R2, local machine):** Printable
whole pack 116s / 398s / 116s → 18-48s. Real 4-photo Complete order, with
the PNG change: median ~85s → ~42s over 3 alternating runs each (new code
24s, 26s, 35s, 42s, and 78s in one run where R2 reads summed to 87s). PNG
encode time is the stable part: 62s → 9s on every run. The rest of the spread is
R2 latency, which varied from 10s to 87s of summed read time between runs.
New tests: `apps/assets/tests_read_resilience.py`, `tests_r2_stall.py`
(real sockets against a local fake S3 that stalls, trickles and resets),
`tests_prefetch.py`; `apps/delivery/tests_photo_reads.py`,
`tests_photo_prefetch.py`, `tests_png_encoding.py`; `test/zip-fixture.ts`,
`zip-integrity.test.ts`, `order-downloads.test.tsx`.

**Caveats still true:** local timings include ~1.4s per Supabase query from
this machine (a local-network artifact; production's database latency is
different) and R2 latency that is much worse than it should be; Railway's CPU
may differ from this machine's. The full backend suite still shows exactly the
23 pre-existing failures inventoried above, unchanged.


---

## 2026-10-04 (later) — Known, separate gap: error and 404 pages return HTTP 200

**Error and 404 pages return HTTP 200 instead of the correct status code.**
Invisible to a real visitor (the page body is right), but it matters for
monitoring and crawlers. Recorded here as a known gap on purpose — **not fixed,
by decision**, and pre-existing: it is not something the `BACKEND_API_ORIGIN`
change introduced (that change only made a missing setting show an error page
instead of a silently empty storefront).

**What was observed** (built `web` image, real browser plus `curl`, 4 Oct 2026):

| Request | What the visitor sees | Status returned | Should be |
|---|---|---|---|
| `/fr/live/<unknown id>`, origin set | "This page wandered off." (the not-found page) | 200 | 404 |
| `/fr/live/<any id>`, `BACKEND_API_ORIGIN` empty | "This page couldn't load" + an error reference | 200 | 500 |
| `/fr/products`, `BACKEND_API_ORIGIN` empty | "This page couldn't load" + an error reference | 200 | 500 |

**RESOLVED 27 Oct 2026.** The cause below was confirmed: with the home
skeleton moved into `app/[locale]/(home)/`, an unknown `/live/<id>` returns
404 on the production image, and the proxy answers 404 for the routes that
keep a skeleton (see CLAUDE.md, "Technical SEO is pinned").

**Probable cause — not isolated by experiment.** `src/app/[locale]/loading.tsx`
sits at the `[locale]` segment level, so it wraps every page beneath it in a
Suspense boundary. Next therefore starts streaming — and commits the 200 status
— before the page's async work finishes; a `throw` or `notFound()` after that
point can swap the body but can no longer change the status. The pages involved
are all `force-dynamic`. This is consistent with Next's streaming behaviour;
nothing here proves it is the only contributor.

**Scope is not fully measured.** Only the live keepsake page and `/fr/products`
were exercised. Any other route under `[locale]` that calls `notFound()` or can
throw is presumed to behave the same, but has not been checked individually.

**Why it matters anyway**
- A monitor or uptime check that looks at status codes sees "healthy" while an
  error page is being served. The container log (`BackendOriginError`, or the
  failing request) is currently the only reliable signal.
- Crawlers read a 404 page served as 200 as a "soft 404". The live keepsake
  pages are `noindex`, which largely neutralises that for them; other routes
  were not examined.

**If someone picks this up:** `loading.tsx` is there on purpose. Its own comment
says a whole-page skeleton is better than the blank page that preceded it, and
that the better fix for the homepage is to wrap only the catalog-dependent
sections in `<Suspense>` so the rest streams immediately. So removing the file is
not a free fix, and the options have not been evaluated.
