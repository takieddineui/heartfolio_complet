# Heartfolio — Implementation Status

> **Hosting note (updated):** Railway and Vercel are no longer used; development
> is local Docker and production is planned as a VPS running the same setup.
> Where this dated document names them as the hosts, read it as history.

**As of:** 31 August 2026
**Companion to:** `heartfolio-discussion-draft.md`, which remains the authoritative
plan. This file records what has been built against it, what was decided during
implementation that the plan did not specify, what was found along the way, and
what is still open. Section numbers (§) refer throughout to the discussion draft.

Nothing in the plan has been superseded. Where implementation forced a decision
the plan left open, that decision is recorded here rather than edited into the
plan, so the original reasoning stays readable.

---

---

## 0. Checked against the original plan, section by section

Verified against the code rather than against the notes below — several
things in this document were written at the time and needed re-checking.

| § | Subject | State |
|---|---------|-------|
| 1 | Product scope | Done |
| 2 | Deliverable naming & sizing | Done |
| 3 | Frame / frameless | Done |
| 4 | Wallpaper Pack | Done |
| 5 | Pricing | Mechanism done; numbers are yours |
| 6 | Sandbox order's pack | Deferred by the plan |
| 7a | Sales analytics | Done |
| 7b | Health checks | Done |
| 7c | Feedback | Done, both modes |
| 7d | Catalog management | Done |
| 8 | Reconciliation | **Built** — needs a sandbox key to exercise |
| 9 | Phone-first ops + Telegram | Done — all three screens |
| 10 | Thank-you page | Done |
| 11 | Occasions from the DB | Done |
| 12 | Transactional email | Done |
| 13 | Meta description prices | Done |
| 14 | Hidden products, all content | Done |
| 15 | Arabic RTL | Done, extended past the original scope |
| 16a | Crawlable category text | Done |
| 16b | AI-readable product pages | Done |
| 16c | Gift-intent pages | Mechanism done, 1 of 4 live (your call) |
| 16d | robots.txt | Done |
| 16e | Merchant Center feed | Done — blocked on `ogImage` before it passes review |
| 16f | Off-site presence | Not an engineering task, by the plan |
| 16g | Expectation-setting | Not a task |
| 17 | ESLint | Done — lint is clean |
| 18 | Bonus deliverables | Done; §18a artwork is a placeholder |
| 19 | AR / VR direction | Scoped — `AR-VR-SCOPING.md` |
| 20 | Preview watermark | Done |
| 21 | AR Pack system | Done except the pack itself (your price) and device testing |
| 22a | Real image verification | Done |
| 22b | Payload size limit | Done |
| 22c | Malware scanning | **Done** — by re-encoding, not by a scanner |

### The three gaps this check turned up — two now closed

**§21 was not sellable. Fixed.** `_supported_targets` validates a pack's
targets against what the product's PNG renderer produces, plus `__live__`
where an HTML renderer exists. AR is served by neither — it has its own
endpoint — so `ar-card` in a pack failed admin validation.

The guard was right and was not loosened. `apps/delivery/ar_support.py` now
declares per-product opt-in (§21b) and the guard consults it, so Love Story
Timeline accepts `ar-card` and `ar-screen` while Where We Met and any
undeclared product still refuse all three. `ar-print` stays reserved and is
supported by nothing (§21j).

**§21c's module-owned scene. Fixed.** The scene id is declared per product
in the same module and travels in the AR payload, so the client selects a
builder rather than inferring one. Inference would have meant a timeline
with no photos silently getting a different experience from one with photos
— the customer changing the behaviour by personalizing, which §21c rules
out.

**Still outstanding: the AR pack itself does not exist.** Nothing sells an
AR target yet, because a pack needs a price and prices are yours (§5).
Creating it is now a dashboard edit: add a pack to Love Story Timeline with
`ar-card` and/or `ar-screen` in its targets, and the admin will accept it.

**§22's closing note. Checked — and it found something else.**

The AR pages themselves are clean: they render no text, use no
`dangerouslySetInnerHTML`, and a test asserts both stay true.

But checking that path surfaced a real hazard elsewhere. All three JSON-LD
blocks — homepage, product page, collection page — emitted structured data
with `dangerouslySetInnerHTML` and raw `JSON.stringify`. **`JSON.stringify`
does not escape `<`**, so a value containing `</script>` closes the tag early
and everything after it is parsed as markup. Verified rather than assumed:
`JSON.stringify({name: "x</script>"})` contains a literal closing script tag.

Every value reaching JSON-LD today comes from translator-authored message
files, so nothing is attacker-controlled and the hazard was theoretical. Two
things made it worth closing anyway, and both are consequences of decisions
taken during this work:

  §7c stores customer-written feedback with `is_published` and
  `display_name`, deliberately built so reviews CAN be published later. The
  moment they are, product JSON-LD gains `AggregateRating` and `Review`
  blocks and customer text lands in exactly this position.

  §7d moved occasions and sizes from compile-time constants to editable
  runtime data.

`jsonLdScript()` escapes `<` as `\u003c`. The output is still valid JSON —
a parser resolves the escape, so Google reads exactly the same data — while
the HTML tokenizer never sees a tag. A test asserts no file passes
`JSON.stringify` straight into `__html` again, because the realistic
regression is a fourth page copying one of the three originals.

---

## 0b. Pre-launch audit items (added after the checklist review)

| Item | State |
|---|---|
| Analytics | **Done** — Plausible always on, GA4 consent-gated |
| Cookie consent banner | **Done** — 3 locales, decline first, no focus trap |
| `llms.txt` | **Done** — generated from the catalog, not hand-written |
| Root `not-found.tsx` | **Done** — was falling through to Next's default |
| Apple touch icon + PNG manifest icons | **Done** — redrawn from `icon.svg` |
| Loading skeletons | **Done** — five routes, layout-matched |

**GA4 is not in the DOM until someone accepts.** Loading it and removing it
on refusal would already have set the cookies and sent the first pageview;
there is no undo for a request that has been made. Advertising signals stay
denied even after consent — permission was given for measurement, not for
advertising profiles.

**`llms.txt` is generated from `getAllProducts()` and `enabledIntents()`.**
A hand-written file would have listed four products when this work started
and would still list three withdrawn ones. Generating it inherits §14's
guarantee: a hidden product cannot appear there any more than in the sitemap.

**I reintroduced §17's bug and lint caught it.** The consent components used
`setState` inside an effect — the exact pattern removed from two hooks
earlier. Here it would have flashed the banner at visitors who accepted
months ago. Replaced with `useSyncExternalStore`, which is the right tool for
a client-only value that differs between server and client, and there is now
a test asserting the file contains no `useEffect`.

**Skeletons mirror the real layouts rather than being generic.** A centred
spinner is easier and worse: content then lands somewhere else and the page
jumps. These reuse the actual container widths, grid columns and 4:5 aspect
ratios, so arriving content occupies roughly the space already held. A
coverage test fails if a new catalog-fetching route ships without one.

The homepage skeleton is whole-page, which is not ideal and is documented as
such in the file: only the featured products and occasions need the catalog,
but the page is `force-dynamic` with no Suspense boundary so Next holds
everything. The better fix is wrapping only those sections in `<Suspense>` —
a restructure rather than a new file, which is why it is noted rather than
done quietly.

**Still open from the audit:** RLS (not applicable as written — no direct
database clients remain), virus scanning (§22c, explicitly non-blocking),
local SEO city pages, loading skeletons, trust signals, and image
compression — which has nothing to compress until `ogImage` exists.

## 1. Status at a glance

| § | Subject | Status |
|---|---------|--------|
| 1 | Product scope — withdraw three products | **Done** |
| 2 | Deliverable naming & real-world sizing | **Done** |
| 3 | Frame / frameless variants | **Done** |
| 4 | Wallpaper Pack | **Done** |
| 5 | Pricing | Mechanism **done**; numbers are yours to set |
| 6 | Which pack the Sandbox order bought | Deferred (unchanged) |
| 7b | Service health checks | **Done** |
| 7c | Customer feedback / reviews | **Done** — both modes, reviews publishable |
| 7a | Sales analytics | **Done** — aggregation tests unrun, see caveats |
| 7d | Catalog management | **Done** |
| 8 | Order/payment reconciliation | **Built** |
| 9 | Telegram alerts + phone-first ops | **Done** — two of three screens; Verify & Reconcile needs §8 |
| 10 | Thank-you page redesign | **Done** |
| 11 | Landing page occasions | **Done** |
| 12 | Transactional email | **Done** |
| 13 | SEO meta description prices | **Done** |
| 14 | Hidden products — all content | **Done** |
| 15 | Arabic RTL | **Done**, extended beyond original scope |
| 16a | Say what Heartfolio is, in crawlable text | **Done** |
| 16b | AI-readable product pages | **Done** |
| 16c | Gift-intent landing pages | **Mechanism done**, one page live |
| 16d | robots.txt excluding customer-flow routes | **Done** |
| 16e | Merchant Center feed | **Done**, with two launch blockers |
| 17 | ESLint warnings | **Done** — lint is clean |
| 18 | Bonus deliverables | **Done** — §18a artwork is a placeholder |
| 19 | AR / VR direction | **Scoped** — see `AR-VR-SCOPING.md` |
| 20 | Preview watermark | **Done** |
| 21 | AR Pack system | **Built** — pack creation and device testing remain |
| 22a | Real image verification on upload | **Done** |
| 22b | Size ceiling on project data | **Done** |

**Verification at time of writing:** frontend typecheck clean, 230 tests passing,
production build succeeds. Backend: 151 database-free tests passing. See
§6 "Caveats" for what has *not* been verified.

---

## 2. What was built

### §1 + §14 — Withdrawing Star Map, Song Poster and Where We Met

Hiding is enforced in three functions in `src/lib/products/registry.ts` —
`getAllProducts`, `getProductBySlug`, `getProductById`. Every product surface in
the app already reached the registry through one of those, so filtering there is
the entire implementation: the homepage grid, `/products`, `/create`, the footer,
the pricing table, the sitemap, the Studio resolver and the slug-redirect
generator all fell into line without individual edits.

Verified in build output rather than assumed:

- sitemap emits `products/love-story-timeline` only
- OG cards generate for one product, not four
- `/waitlist` is absent from the route table
- `routes-manifest.json` contains no `/products/*` redirects, so
  `/products/heart-map` returns a genuine 404 rather than a 301 to a page that
  then 404s — the correct signal for a crawler holding the old URL

Also removed: the `/waitlist` page, its API route, and `src/lib/supabase/`
(the waitlist page was its only consumer — leaving a live public endpoint
writing to a database for a deleted feature was worse than removing it).
**Supabase environment variables are now unused.**

Hero imagery was rebuilt around a single product. Site-level meta copy in
`Meta.description`, `Meta.ogAlt` and `Collection.meta.description` no longer
names withdrawn products.

### §11 — Occasions derived from the live catalog

`getAvailableOccasions()` in `catalog.ts` derives the homepage occasion cards
from products that are both non-hidden and `available` in Django. `GiftOccasions`
takes the list as a prop and returns `null` if none survive.

The section drops from five cards to two (anniversary, wedding). New Baby, In
Memory and New Chapter pointed at empty result grids. The subtitle, which read
"A wedding isn't a birth. A loss isn't a celebration," was rewritten in all three
locales because it named the two occasions being removed.

### §13 — Prices in meta descriptions come from Django

Meta descriptions take `{price}`; each has a `descriptionNoPrice` sibling used
when no price is available (outage, or product not purchasable). The page never
guesses and never emits a half-finished sentence.

Applied to all four products, not just the live one — leaving `$12 USD` in the
hidden three means unhiding one silently republishes a stale price.

`src/messages/messages.test.ts` asserts no locale writes a currency figure into
copy, every priced description has a fallback, and all three locales carry
identical keys. Checked against the original files: it would have failed on five
strings per locale.

### §15 — RTL, extended beyond the original scope

The plan described Studio chrome. Four physical-side utilities were fixed there
(`studio-layout.tsx` sidebar divider, `checkout-flow.tsx` close button and pack
buttons, `field-inputs.tsx` slider readout).

While investigating layouts for §2, the same bug was found in the **poster
itself** — `renderer.module.css` used `text-align: left`, `border-left` and
`padding-left` — and in the **delivered HTML keepsake**, where the timeline
spine, milestone indent and dots were all hard-left. Those pixels are the
product, not editor furniture, and they now go into six print files rather than
one. All converted to logical properties.

`src/components/studio/rtl.test.ts` guards both TSX and CSS. It was verified to
fail on a reintroduced regression in each.

### §16b + §16d + §16e

**16d.** `robots.txt` previously disallowed only `/api/`, on a comment reasoning
that "the Studio route does not exist yet." Now excludes `/create`, `/studio`,
`/project` and `/orders` across all three locales plus unprefixed forms,
generated from `routing.locales`. Deliberately *not* paired with `noindex` — a
`Disallow` prevents the fetch, so a crawler never reads a `noindex` behind it,
and combining the two is a known way to get a URL indexed without a description.

**16b.** Factual gaps closed (see §4 below for what was wrong). The sizes and
formats section renders from `PRINT_SIZES` rather than a written list, so the
page cannot advertise a size the renderer does not produce. Tests guard both
drift directions.

**16e.** Merchant Center feed at `/<locale>/product-feed.xml`, one per locale.
One item per pack rather than per product, tied by `item_group_id`, because
Merchant Center requires an item's price to match its landing page and Love
Story Timeline has four packs at four prices. Not under `/api/`, because Google's
feed fetcher honours robots.txt on scheduled fetches.

### §2 + §3 — Sizing and mounting variants

Frontend: `src/lib/studio/print-sizes.ts` holds one universal size list — A4/A3
(1:√2), Classic 8×10 (4:5), Poster 12×18 (2:3) — with orientation resolved per
layout. `src/lib/products/deliverable-names.ts` translates target ids into
customer-facing names.

Backend: `apps/delivery/print_sizes.py` mirrors it; the renderer applies the
mounting inset to the same content box the decorative frame axis already used, so
the timeline genuinely reflows. Packs are composed from `all_print_target_ids()`
so a pack cannot contain a frameless file without its edged pair.

Verified empirically, not from the code:

```
print-png            2480×3508   first content row 26
print-a4-frameless   2480×3508   first content row 26
print-a4-edged       2480×3508   first content row 150
```

Same paper size, content starting exactly one safe margin lower, legacy path
geometrically unchanged. Five backend tests assert this at pixel level, including
one that samples the entire margin band on all four edges.

### §22a + §22b — Validation

Uploads go through `Image.open()` + `.verify()`. Three additions beyond the
plan's specification, each with a test:

- the **detected** format is checked against the allowed list, not merely "did
  something decode" — a valid BMP declared as PNG decodes perfectly
- the detected type is stored and served, overriding the client's claim, because
  serving bytes under a contradicting Content-Type is the basis of sniffing
  attacks
- `DecompressionBombError` is caught and rejected as too large — a small
  compressed file expanding to an enormous bitmap passes the byte-size check by
  definition

A 256KB ceiling on serialized `data`, on both create and update, measured in
bytes rather than characters so multi-byte content cannot exceed the intended
size. It deliberately says nothing about payload shape; one test asserts an
unfamiliar structure is still accepted, because the backend not knowing what a
Love Story Timeline looks like is the boundary that makes `apps/projects` work.

`MAX_PROJECT_DATA_KB` is documented in `.env.example`.

### §10 — The thank-you page

Built on `/orders/[orderId]` as §10 specifies, rather than a new route. It
now carries payment confirmation, downloads, the §7c review box, and the
other-products strip.

**The success popup now offers the page rather than replacing itself with
it.** Downloads stay in the popup so nobody is forced to navigate to get
what they just paid for, and a "View your order" button leads to the page
where the rest of §10 lives — which is also the URL the §12 receipt points
at. An automatic redirect would yank the page out from under someone
mid-download.

**Both new sections sit below the downloads.** The customer came for their
files; asking for a rating or offering another purchase above the thing they
paid for would put our interests ahead of theirs on the page confirming the
sale.

**The other-products strip renders nothing today, and that is correct.**
§10 was written when four products existed; §1 left one, so the only "other"
product is the one they just bought. A heading above an empty space is worse
than no section. The component is wired in so restoring or adding a product
brings it back with no further work.

It excludes the purchased product by Django id rather than slug, because an
order records `heart-map` while the public slug is `where-we-met` — matching
on slug would have silently failed to exclude exactly the products whose two
identifiers differ. Three tests cover the filtering, including that a
withdrawn product can never appear here.

### §17 — The two ESLint errors

Fixed deliberately in the end. §17's plan was to fold them in whenever
`use-studio-session.ts` and `use-delivery-packs.ts` were touched for real
work, and that moment never came — §4 was pack work but went through
`exports.ts`, the seed and the renderer, never the hook.

Both were the same pattern: a synchronous `setState` at the top of an effect
to reset to a loading state when inputs changed. **That was not only a lint
complaint — it was a visible bug.** An effect runs *after* render, so on the
render where the product id changed, the component painted the PREVIOUS
product's packs and prices before the reset landed. A customer clicking
between products fast enough could see a price that did not belong to what
they were buying.

Both hooks now store the resolved value alongside the inputs it was resolved
for, and derive "loading" from a mismatch. No reset, no extra render, and no
frame in which stale data is displayed as current. Lint is clean: zero
errors, zero warnings.

### §4 — Wallpaper Pack

Three dedicated per-device renders — phone (1290×2796), tablet (2048×2732),
desktop (3840×2160) — replacing the legacy `story-png` / `landscape-png`
shapes the pack used before. Watch faces were explicitly skipped.

**The safe zones are what make these renders rather than resizes.** Each
device declares the fraction of canvas that must stay clear of OS furniture:
the lock-screen clock, the home indicator and first icon row, a desktop dock
and icon column. Verified at pixel level — content starts at row 503 on
phone (2796 × 0.18), 328 on tablet, 129 on desktop, exactly the declared
fractions, with the bands sampled and asserted empty.

**A real bug surfaced doing this.** Type sizes derived from canvas *width*,
which works for the prints because they are all portrait — width is their
narrow edge. A desktop wallpaper is 3840×2160, so that gave 173px headings
inside ~1800px of usable height and the header overflowed into the dock.
Wallpapers now size from whichever edge of their content box is smaller,
scoped to wallpapers only: applying it everywhere would have changed
`landscape-png`, a legacy target whose output must stay stable for orders
already placed. Confirmed unchanged, along with every print.

The footer positioning also needed a clamp — `max()` alone let an
overflowing timeline push it past the content box into the safe zone.

**Complete now means everything** (your decision): six prints, three
wallpapers, and the live page. Its price is unchanged and is yours to set.

**The safe-zone numbers want a real device.** §4 defers the pixel spec
deliberately, so these are defensible values based on where OS furniture
sits, not measurements from a screenshot. They live in one file per side so
correcting them is a single edit.

### §7c — Customer feedback

New app, `apps/feedback`. One model with a nullable `order` — that single
column is what separates the two confirmed modes, because everything else
about them is identical and splitting would double every query and admin
view to express one boolean.

**Your three decisions**, and what each cost in schema:

*Private now, publishable later.* `is_published` defaults False and nothing
in the API can set it. `display_name` exists but is not collected — if these
ever appear on a product page they need attribution, and back-filling that
means going back to customers to ask. `product` is denormalized rather than
read through `order`, because a public listing is per-product and general
feedback has no order to reach one through.

*Rating required, message optional.* Requiring words would lose the quick
five-star tap, which is what most people actually give.

*Email optional, general mode only.* An email on an order-tied submission is
noise — the order already knows who to reply to, and a second unverified
address invites replying to the wrong person.

**Ownership reuses §12's magic-link token.** Leaving feedback works from the
emailed receipt on a device with no session, which is where someone actually
is when they have just opened their keepsake. A bad token, a token for a
different order, and a missing order all raise the same error, so probing
order ids reveals nothing.

**There is no list or detail endpoint.** Submissions are read in Django
admin, where the customer's own words are read-only — only `is_published`
and `display_name` are editable, because those are staff decisions and
editing what someone wrote before publishing it is precisely what must not
be quietly possible. Ten tests, most of them asserting what a submitter
cannot do.

**Both modes now have a UI.** Order-tied lives on the thank-you page (§10);
general lives at `/feedback`, reached from the footer and from a prompt at
the end of the homepage FAQ — where someone who has read every question and
not found theirs is already looking for a way to reach a person. Deliberately
not a floating tab: a persistent widget would compete with the buy button on
every page of an art-directed storefront.

**The rating rule was refined after the model was built.** The original
answer was "required on every submission"; the general mode then needed it
optional, because someone reporting a broken link has nothing to award stars
to and forcing a number would either lose the submission or produce a
meaningless one that pollutes any future average. `rating` is now nullable,
with the serializer enforcing "required for order-tied, and at least one of
rating or message otherwise" — a rule that depends on which mode a submission
is in, which no column constraint can see. Migration `0002_alter_feedback_rating`.

One earlier test asserted the old rule and had to be rewritten rather than
deleted, so the change is visible in the history rather than silently gone.

### §7c — Publishing reviews

Published reviews now render on the product page and the homepage. Nothing
on the submission path can publish anything — every query filters
`is_published=True`, a flag only staff can set in Django admin.

**`AggregateRating` is emitted only when reviews exist.** Google treats an
aggregate with nothing behind it as a structured-data violation and the
penalty lands on the domain, not the page. `ratingSummary` returns None
until something is published and the JSON-LD spread adds nothing —
`ratingCount: 0`, or a default 5.0 to make the markup look complete, is
exactly the failure being avoided.

**The section renders nothing when there are none**, which today is always:
nothing has been sold, so nothing has been reviewed. Same rule as §10's
other-products strip and §11's occasion cards. There is deliberately no "be
the first to review" prompt either — on a page whose job is to sell, that
advertises that nobody has bought this.

**A name is now collected at submission**, which is a change from §7c's
original design where `display_name` was staff-only. **Your decision**, and
the reason is timing: a name cannot be retrofitted onto reviews already
written without going back and asking each person, so collection has to
start before reviews accumulate rather than when publishing begins.

Giving a name grants nothing. `is_published` remains staff-only and defaults
False; the placeholder says the name is shown only if we publish the note,
so the field cannot be read as consent. One earlier test asserted
`displayName` was refused from submitters — rewritten rather than deleted,
so the change is visible in the history.

Reviews published without words are excluded from display but still count
toward the average: a bare star with a name under it tells a reader nothing,
but it is real signal in the aggregate.

### §22c — Upload sanitization

Answered by **re-encoding**, not by a scanner. Every upload is decoded and a
fresh image written from the pixel data alone, so nothing that is not pixels
survives — appended payloads, polyglot files, hostile chunks, embedded
scripts. Demonstrated rather than asserted:

```
original bytes: 210 | contains payload: True
§22a verdict   : image/png  (accepted — it IS a valid image)
stored bytes   : 177 | contains payload: False
still an image : PNG (80, 80) (200, 120, 90)
```

**Why not a scanner, given §22c names one.** A third-party API means
uploading customers' photographs — often intimate ones — to another company
for analysis, on a product whose premise is personal memories, and it would
need declaring in the privacy policy. Self-hosted ClamAV avoids that but
needs a daemon, roughly a gigabyte of signatures and perpetual definition
updates on the production host. Re-encoding needs none of those and defends against
tomorrow's payload rather than yesterday's signature. **Your decision**,
from four options.

**What it does not do**, stated in the code: it will not detect a genuine,
well-formed image that is malware bait for some *other* decoder further down
a chain. §22c notes that chain does not exist here — uploads are only ever
consumed by Heartfolio's own Pillow renderer — but if a customer file is
ever handed to a third party, this is not the control that covers it.

**EXIF is stripped as a side effect**, which is a privacy improvement worth
having independently: phone photographs carry GPS coordinates, and a
keepsake product had no reason to be storing where its customers live.

Format is preserved so the recorded `mime_type` stays truthful, and
`image.load()` forces a full decode — `Image.open` is lazy, and without it a
file failing partway through would be saved as a truncated image rather than
rejected.

### §8 — Verify & Reconcile

**I was wrong that this was blocked on credentials.** The plan's open
question — what Paddle's API supports filtering by — is public
documentation. Credentials are needed to *exercise* this, not to build it.

What the API allows, and what it does not:

  * `GET /transactions?id=` — direct lookup
  * `GET /customers?email=` — exact; `?search=` is fuzzy across id, name
    and email
  * `GET /transactions?customer_id=`, plus `status` and `created_at`
    operators
  * **No filtering by `custom_data`** — which is where Heartfolio's
    `orderId` lives

That last point shapes the whole design. "Find the Paddle transaction for
this order" cannot be a query. For orders that received a webhook it need
not be — the transaction id is on the `Payment` row. But §8 exists for the
orders that never got one, and those have no stored id. So the route is:
order → its email → Paddle customer → their transactions → match
`custom_data.orderId` in Python.

**This module contains no verification logic, deliberately.** §8 asks for
"the exact verification logic the webhook already uses, just triggered
manually". Taken literally, that means not reimplementing it — so
reconciliation fetches the transaction, packages it as the same
`PaddleWebhookEvent`, and calls `confirm_paddle_webhook_payment`. Identical
currency check, amount check, transaction-belongs-to-this-order check,
locking and idempotency. A second implementation would be a second thing to
keep correct, and the one that drifted would be the one nobody tests,
because it only runs when something has already gone wrong.

**The one check this path must add for itself:** the webhook route only runs
for a `transaction.paid` event, so the event type proves success. Fetching
by id proves nothing — Paddle returns failed, cancelled and draft
transactions just as readily, and reconciling one would mark an order paid
that never was. That is §8's "no manual override" rule defeated by a
different route, so `is_completed` is checked before anything is built.

**Exact email matching, not `search`.** Fuzzy matching spans id, name and
email and could return a different customer whose details merely resemble
the query. Presenting someone else's transactions as reconciliation
candidates is the worst failure available on this screen.

**An outage is never reported as absence.** Staff must not read "Paddle is
down" as "no payment exists" — the conclusion drawn would be the opposite of
the truth.

The screen completes §9's phone-first set. There is no status field on it:
the only action is to ask Paddle.

**Not exercised.** Every test mocks the HTTP layer. A sandbox key and one
real reconciliation are needed before trusting it against live data.

### §21 — AR Pack system

Built as §21 specifies: AR is a `DeliveryPack` like any other, one new
table, everything else an extension of what exists.

**`DeliveryType.AR` is checked BEFORE the pack-slug map**, unlike every
other prefix. The pack map disambiguates targets whose type depends on how
they were sold (`story-png` is social or wallpaper by pack); AR has no such
ambiguity, and letting a slug win would misclassify it the moment `ar-card`
joined the printable pack. Additive by construction — no existing target
starts with `ar-`.

**The AR row is created in the same verified webhook step that grants the
entitlement**, not a separate hook. A second step would be another place a
paid order could end up half-provisioned, which is the failure the §9 lookup
screen exists to find. `get_or_create` keeps it idempotent: a redelivered
webhook must not mint a second URL, because the first may already be printed
on something.

**§21f's security list is implemented, not assumed.** One generic 404 for a
malformed id, an unknown id, a revoked experience and an unpaid order —
distinguishing them would turn a guessing attempt into a working oracle.
There is no list endpoint and a test asserts none exists. `X-Robots-Tag` on
the API, `noindex` on the page, throttled, no personal data in the URL, and
a test asserting nothing in navigation or the sitemap links to `/ar`.

**Two things are genuinely unresolved, and §21 says so itself:**

⚠️ *The scene has never run on a device.* §21i flags iOS Safari's camera and
WebGL support as needing real testing, "not something a code audit can
confirm". It is written to fail visibly — a refused camera, an unsupported
browser and a failed library load each produce their own message, because a
blank screen is indistinguishable from a broken product to someone holding a
printed card.

⚠️ *The tracking target is an assumption.* §21i corrects itself that whether
each card needs its own image target is not yet decided. This implements the
SHARED-target reading — one `.mind` file, personalization composed on top —
because it works without per-order asset generation. If per-order targets
win, `TARGET_URL` becomes a per-experience API value and nothing else
changes.

MindAR and Three.js load from a pinned CDN rather than being bundled: this
route is the only place needing them, and bundling would add megabytes to
every build to serve a page most visitors never see.

**Not built**, per §21j: AR Print's workflow (architecture-reserved only),
preview URLs, NFC triggers. The `.mind` target file itself does not exist —
it is produced by MindAR's compiler from artwork that has not been designed.

### §9 — Order lookup screen

`/ops/lookup/`, phone-first, the second of §9's three purpose-built screens.
Search by customer email or order id; the third (Verify & Reconcile) belongs
to §8 and needs Paddle credentials.

**`status == "paid"` is not the answer to the question this screen is
asked.** The complaint that brings someone here is "I paid and got nothing",
and the shape of that is an order marked paid with **no entitlements
granted** — payment confirmed, delivery never provisioned. Such an order
looks perfectly fine in Django admin.

So each result carries a derived condition rather than echoing a column, and
`paid_no_entitlements` exists specifically because it is the failure this
screen is for. It renders as "PAID — but nothing was delivered", flagged red.
Without it the screen would show a reassuring "paid" beside a complaining
customer, and the reader would have to already know to go and count
entitlements.

**A partial order id matches.** The realistic input is a fragment pasted from
a customer's email on a phone; requiring a full UUID would make the screen
useless in exactly the situation it was built for. Matching is on the text
form of the id rather than casting the query, so a partial paste is a prefix
search instead of an error.

Read-only by design: this answers "what happened", and any action taken as a
result belongs on a screen that says what it is about to do.

The three ops pages now link to each other — without that, reaching one from
another means typing a URL on a phone, which is the moment the tool stops
being used.

**Verification gap:** the query tests need a database and are unrun here. The
condition logic — the part that carries the value — is database-free and
passes, and all three templates were rendered and checked.

### §9 — Telegram alerts

A free bot pushes a message when something serious happens, rather than
relying on remembering to open the dashboard. Two triggers, as §9 names them:
a health check changing state, and a payment that cannot be verified.

**Alerts fire on TRANSITIONS, not states — the decision everything else
follows from.** The health checks run on a schedule. If each run alerted on
what it found, a service down overnight would send a message every polling
interval; the predictable result is that alerts get muted and the one that
mattered arrives silenced. A service going down sends one message. Recovery
is alerted too, because "is it back?" is the question immediately after "is
it down?".

State lives in a table (`ServiceAlertState`), not memory or a file: a
redeployed container starts with a fresh filesystem, so anything else would
forget on every deploy and re-alert on everything. It is written even when the
send fails — otherwise a Telegram outage during an incident would re-alert on
every run once it recovered, which is the storm this prevents.

**The payment alert sits at the webhook boundary, not on each branch.**
`confirm_paddle_webhook_payment` has five reconciliation failures; alerting
per branch would mean a check added later silently not alerting, which is the
failure mode an alerting system can least afford. The exception is re-raised
unchanged so Paddle's retry behaviour is untouched.

**A test caught a bug that would have fired constantly.**
`logger.info(..., extra={"message": ...})` collides with `LogRecord`'s
reserved `message` attribute and raises `KeyError` — meaning every *skipped*
alert would have crashed, which is every run in an unconfigured environment.

`python manage.py check_services` runs the checks and alerts; `--no-alerts`
prints without sending. An unconfigured run says so out loud rather than
passing quietly, because a scheduled job that silently never alerts looks
identical to one where nothing is wrong.

**Config:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, documented in
`.env.example` with how to obtain both. Blank disables alerting entirely.

**Verification gap:** the seven transition tests need a database and have not
been run here. The send-path tests are database-free and pass, and the
management command was executed end to end.

### §7d — Catalog management

Products and packs were already manageable in Django admin, with
`included_targets` validated against what renderers can produce. The new work
is §11's architecture note: occasions and print sizes as real entities rather
than a hardcoded tag map and code constants.

**They are not the same kind of thing, and the models differ accordingly.**
An `Occasion` is pure metadata — adding "New Home" requires nothing of the
renderer, so it is unrestricted. A `PrintSize` is a promise about pixels:
`print-a2-frameless` only exists if a renderer produces those dimensions with
correct margins and a label exists in three languages.

**The guard, and why it is there.** You chose "fully manageable, accept the
risk"; I put the concrete consequence in front of you and you took the
guarded version instead. A size can now be created, renamed, reordered and
saved freely — but cannot be made *active*, because active is what makes it
sellable. Without that, the chain is: row saves, size enters a pack, product
page advertises it, Paddle charges, customer downloads and gets a 501 —
after paying, with nothing earlier catching it. The same chain
`_supported_targets` was written to prevent one level down.

`is_sellable` is computed from the renderers themselves, never stored: a
stored flag goes stale, and stale in the permissive direction is exactly what
lets an unsellable size be sold.

The guard lives in `assert_size_can_be_sold()` rather than the admin form,
because a `ModelForm` runs a uniqueness query before reaching `clean()` —
which would have made the one test that matters depend on Postgres being
available.

**Seeded from the constants that are live today**, with `get_or_create` so
re-running never reverts a name or order changed in the dashboard — the same
principle as the §5 price protection. An empty occasions table would mean a
storefront showing no occasions at all.

**The frontend now reads them.** Occasions and print sizes ride along with
the catalog responses the storefront already fetches, so managed data costs
no extra request per render.

**The list endpoint's shape changed, and that needed care.** It returned a
bare array; it now returns an object. The frontend and backend deploy separately (Vercel and Railway, then),
so one is always briefly ahead of the other, and a storefront returning no
products during that window is a real outage rather than a cosmetic one. The
frontend accepts BOTH shapes, which makes the change deployable in either
order. That tolerance can be deleted once both sides have been live together
long enough that no old build is still serving.

**Managed data replaces the static definitions; it never merges with them.**
Merging would mean an occasion deleted in the dashboard kept appearing
because the code still knew about it, which defeats the point of making them
editable. When Django sends no taxonomy — an outage, or an older backend —
the static definitions are used instead, so a transient backend problem never
looks like a deliberate content decision. Same reasoning as §1's hidden flag.

Only KEYS come from the database. The customer-facing wording stays in the
message files, because a name typed into an admin form would be English on an
Arabic page.

**Still static, deliberately:** the sitemap and the gift-intent registry.
Both must work at build time, and any route reading the catalog has to be
dynamic — the lesson from the three prerender failures. Making intents
database-driven would put a fetch in the sitemap.

### §7a — Sales analytics

`/ops/reports/`, desktop-oriented per §9, behind the same admin login as the
status page. Everything §7a lists: weekly/monthly/yearly revenue and order
trends, breakdowns by category, product and pack, buyer country, average
order value, new vs returning customers, and the unpaid-order rate.

**The one input that did not already exist was buyer country.** §7a says to
source it from Paddle's own transaction record rather than a new checkout
field — and the webhook parser was dropping it. It is now read from
`data.address.country_code` and stored on the order at payment confirmation
(migration `0004_order_buyer_country`), rather than fetched when a report
runs: a report calling Paddle per order would be slow, would need live
credentials to produce a historical number, and would give a different answer
if Paddle ever changed the record.

Paddle does not promise an address on every webhook, so the parser treats it
as optional at every level and the country breakdown shows an **Unknown**
bucket rather than dropping those orders — a breakdown whose rows do not add
up to the total above it is worse than one admitting a gap.

**Decisions inside the numbers**, each of which could have made a figure
quietly wrong:

*Revenue buckets on `created_at`, not payment time.* An order placed on the
last day of a month and paid on the first of the next belongs to the month
the customer decided to buy; webhook retries would otherwise move revenue
between periods for non-business reasons.

*New vs returning counts customers, not orders.* Someone who bought four
times is one returning customer; counting orders would make repeat business
look like new business.

*The failure rate counts orders, not payment attempts.* An order that failed
twice then succeeded is a success — the customer has their keepsake.
`pending` is grouped with failures because an order that never reached paid
is lost revenue whatever the reason, which is what "failed/abandoned" means.

*Money is formatted in the view, not the template.* `total_cents` is minor
units, and dividing it in a template filter is how a revenue figure becomes
wrong by a factor of a hundred.

**Verification gap.** The aggregations are ORM queries and need Postgres,
which is not available in the environment they were written in. The country
parsing tests are database-free and pass; the template was rendered and
checked. The six aggregation tests in `SalesAnalyticsTests` are **written but
never run** and need a machine with a database.

### §7b — Service health checks

The green/red version §7b recommends starting with, not the log viewer it
flags as a much larger project. It answers "is it up", never "what happened".

`/ops/status/` is a phone-first page behind `staff_member_required` — §9's
"same login throughout", so there is no second credential and no new auth
surface. Deliberately not an extension of `readiness_check`: that endpoint is
polled continuously by the platform, and its own docstring explains why it
must not make network calls to R2 or Paddle on every poll. These checks are
human-triggered instead.

`/ops/status.json` returns the same results for §9's Telegram alerting, which
needs to ask "is anything down" on a schedule without scraping HTML. The
alerting itself needs a bot token and chat ID and is not built; shipping the
page without the endpoint would have guaranteed this logic got duplicated
later.

**Three decisions worth knowing:**

*"Not configured" is its own state.* Paddle has no key locally, R2 no bucket.
Reporting those red would train the reader to ignore red, so they report
unknown — which is the truth: this deployment cannot say. Unknown alone never
turns the headline red.

*Paddle is checked with an authenticated call, not a ping.* `GET /event-types`
requires a valid key, so a revoked key reports failing. Pinging Paddle's
website would have shown green while every payment was being refused. The
result also names the environment, since green against sandbox while
believing you are live is its own kind of outage.

*No check can bring down the page.* Each returns a result rather than raising,
and `run_all_checks` catches even a crashing check. A status page that 500s
when a service is down is useless at exactly the moment it is opened. Twelve
tests, most of them about failure rather than success.

### §18 — Bonus deliverables

All four, added to the pack download rather than stored as entitlements. An
entitlement is proof that something was *bought*; a bonus is a consequence of
what was bought. Deriving them means a change to what a bonus is applies to
past orders too, and the entitlement table keeps meaning one thing.

The rules read the pack's `included_targets`, not its slug — a renamed or
newly added pack gets the right bonuses without anyone updating a list.

**Two new dependencies, declared with reasoning** (`reportlab`, `qrcode`).
`reportlab` was already present in the build environment but undeclared, so
it was incidental rather than yours. Pillow can wrap an image in a PDF, which
is all §18c needs, but cannot typeset the printing-advice sheet — a text PDF
made by pasting rendered text into an image has no selectable text and blurs
at print size.

**A wrapped print keeps its true physical size.** The PDF page *is* the
artwork: 3600×5400 at 300dpi produces an 864×1296pt page, verified against
the MediaBox. Forcing A4 would silently resize a 12×18 poster and a print
shop would have no way to know.

**The QR encodes a link that actually works.** Built from the same magic-link
token as the §12 receipt, so scanning it on a phone that has never seen the
site opens the order. A QR pointing at a URL that then demands a session
cookie would be a QR that does not work. High error correction, because it is
printed, photographed and scanned off paper.

**Bonuses can never cost a customer what they paid for.** Both the PDF
wrapper and the bonus block are individually wrapped: if either fails, the
purchased files are already in the archive and the download proceeds, with
the failure logged.

**This reversed an earlier fix, deliberately.** §16 removed every "PDF" claim
from the copy because none existed, with a test asserting no locale mentioned
one. §18c makes them real, so the copy now names both PNG and PDF — and the
test was rewritten to check the claim is *accurate* rather than *absent*,
since deleting it would have left the original bug class unguarded.

**⚠️ §18a's card is a placeholder.** §18a describes a branded asset, which is
artwork rather than code. The delivery path is real, tested and attached to
every purchase; replace the output of `render_thank_you_card()` with the
designed file when it exists — nothing around it needs to change.

### §16c — Gift-intent landing pages

`/gifts/<intent>`, built from an intent registry where each page defines a
predicate over the live catalog rather than a hand-written product list.
`getAllProducts()` already excludes hidden products, so §14's guarantee is
inherited rather than re-implemented — the same filter that protects the
homepage, the sitemap and the Merchant Center feed.

An intent with no matching products has no page: it is absent from the
sitemap and the route 404s. A landing page promising "printable gifts" above
an empty grid is worse than no page, and it is the same failure §11 removed
from the homepage's occasion cards.

**Four intents defined, one live — your decision, and the reason matters.**
With a single active product, four intent pages would each list the same item
and differ only in a heading and an intro. That is the shape search engines
treat as doorway pages, and the penalty falls on the whole domain rather than
the offending URLs. `printable-gifts` went live because it answers something
`/products` does not: what you physically end up with. The other three are
written, translated and switched off, so enabling one later is a one-line
change rather than a change plus a translation scramble.

**The same build failure appeared for the third time.** `generateStaticParams`
made Next prerender the route, the `no-store` catalog fetch threw, the
fallback swallowed it, and an empty product grid would have been baked into
the static shell on every deploy. Fixed the same way as `/products`:
`force-dynamic`, with `findIntent` enforcing validity instead. Any route
reading the catalog has to be dynamic — this is now a pattern worth watching
for rather than a one-off.

### §16b — Who it's for, and what occasions

The last two checklist items. The prose is written per product; the occasion
list is **derived from the product's own tags**, so a page can only claim
occasions the catalog actually backs. Writing them by hand is how a page ends
up advertising "perfect for a new baby" for something tagged anniversary and
wedding — the same mismatch §11 removed from the homepage. Labels come from
the `GiftOccasions` namespace rather than a second set of strings, so an
occasion is worded identically wherever it appears.

Four tests cover it, including one asserting every derived key has a label —
without it, a newly tagged product would render a raw message key on a live
page.

### §16a — Saying what this is, in plain text

Two placements, **your choice of "more than one"**: the hero's one-line
definition now names the category (personalized digital keepsakes, printable
gifts, anniversaries, weddings), and a "What is Heartfolio?" entry sits first
in the homepage FAQ, stating the category, who buys it, that it is printable,
and that it is an instant download.

I skipped the third option — a separate passage below the hero. §1 and §11
already thinned that page, and a paragraph whose only job is to state the
category tends to read as exactly that.

**The homepage had no FAQPage structured data.** The product page had it; the
homepage did not, so six real questions — including the plainest statements on
the site about what you receive and how printing works — were invisible to the
readers §16a is about. Added, built from `HOMEPAGE_FAQ_KEYS`, the same list the
visible section renders from, so the markup and the page cannot list different
questions (§29).

**Nine more false PDF claims found and fixed.** The earlier §16b pass corrected
the product page; the same claim was still live in the homepage FAQ, the "how
it works" step, and the offering details beside the buy button — in all three
locales. The homepage FAQ also advertised printing at 11″ × 14″, which is not a
size produced and is not a clean crop of any of the three that are, so anyone
printing at it would have had their design trimmed.

The guard test is why this is worth recording: it existed, and it missed them,
because it only scanned `ProductPage.included.items`. A claim about what the
customer receives can be written anywhere in the copy, so it now walks every
string in every locale. Verified to fail on the homepage claim specifically.

### Locale on the order

`Order.locale`, captured automatically from the site language at checkout
(migration `0003_order_locale`). **Your decision**, from three options: the
order rather than the customer or the project, because both things needing a
language descend from an order — the email is *about* the order, and the
delivered file is produced through an order's entitlement. On the customer it
would be wrong for someone buying gifts for recipients in different countries;
on the project it would leave the email reaching through to a project that may
not exist, since `Order.project` is nullable.

Threaded through the delivery contract (`ProductRenderer.render` now takes
`locale`, defaulted so renderers with no use for it can ignore it) to the HTML
renderer, which emits the right `lang` and `dir`. Verified:

```
en: <html lang="en" dir="ltr">
fr: <html lang="fr" dir="ltr">
ar: <html lang="ar" dir="rtl">
```

Read from `Order.locale` at download, never from the current request — a
re-download months later in a different browser language must return the
artifact that was bought. `SUPPORTED_LOCALES` in settings constrains what the
API will accept, so an arbitrary string cannot reach a keepsake's `lang`
attribute.

**Still to do for §12:** this makes email possible but does not build it.

### §5 — Prices live only in the database

No numbers were changed; that is yours to do. What changed is that code no
longer competes with the database for the answer.

`registry.ts` carried a comment spelling out a figure per pack "as a
structure". Only a comment, so it could not render — but it was a second
source of pricing truth that would go stale the moment real prices were set,
and that someone would later read as authoritative. Removed.

`seed_catalog.py` was the more serious one. It used `update_or_create` with
`price_cents` in the defaults, so **every re-run overwrote the database
price**, and its own docstring described that as the way to apply a price
change. That bundled two unrelated reasons to run the script: fixing a pack's
included targets, and setting a price. Anyone re-running it for the first
reason would silently revert prices set for the second.

Now: prices are written only when creating a row, or when the operator passes
`--update-prices`. Any difference on an existing row is printed and left
alone, so drift is visible rather than either applied or hidden. The decision
lives in `seed_price_policy.py`, extracted so it is testable without importing
the script (which calls `django.setup()` against production settings at import
time). Five tests cover it.

**Not verified end to end.** The full script run needs a database, and there
is no Postgres in this environment; `base.py` also pins the engine to the
Postgres wrapper, so sqlite cannot stand in. The policy function is tested
directly; the script itself should get one run on a machine with a database.

### §12 — Transactional email and magic links

Resend, called over plain HTTP (one POST; `requests` is already a dependency,
and a vendor SDK for a single call is a dependency to maintain for nothing).
Fired when an order transitions to `paid`, from inside the verified webhook
path.

**Sent after the atomic block closes, not inside it.** Inside, an HTTP call to
Resend would hold the order's row lock open for the whole round trip and
serialize concurrent webhooks behind a slow provider — and a send that
succeeded inside a transaction that then rolled back would email a customer
about an order that does not exist. Outside, the failure mode is a missing
receipt for a working order rather than a receipt for a broken one.

**`send_order_confirmation` never raises.** The catch is intentionally broad
and the tests pin it there: `requests.RequestException` alone is not enough,
because a bug in the template rendering raises something else entirely and
would make a successful payment return 500 to Paddle over a formatting
mistake.

**Magic-link tokens** (`apps/commerce/order_access.py`) — Django's
`TimestampSigner`, no new dependency, no token table, no revocation list.
Scoped to one order: a token for order A gets you nowhere with order B, so a
forwarded receipt is not a skeleton key. Salted so a signed value minted
elsewhere in this project cannot be replayed here. 30-day expiry.

Token access is wired into all four endpoints the order page needs — order
detail, entitlements list, single download, pack download — as an
*alternative* to the session cookie rather than an addition, since the link
has to work on a phone that has never seen the site.

**English only**, per your decision, even though `Order.locale` now exists. A
test asserts the template stays English for an `ar` order, so changing it
later is deliberate rather than accidental.

**Links to `/orders/[id]` as it exists today.** §12 describes linking to the
§10 thank-you page; that page is not built, and §10 has its own blockers (its
review box is where §7c's feedback feature lives, and its "other products"
strip has nothing to show). The magic-link mechanism — which is what actually
closes the "customer lost their download" gap — is complete and independent
of that.

### §20 — Pre-payment preview watermark

Repeated diagonal `theheartfolio.com` at 13% opacity over the in-browser
preview. `aria-hidden` and `pointer-events-none` — it is anti-theft
decoration, not content.

**The watermark is a sibling of the registered export node, never a child.**
§20 argues the watermark cannot reach a purchased file because preview and
delivery are separate render paths, and that is true today. But
`ComponentRenderer` registers the preview node via
`registerExportTarget("default", node)`, and `exportTargets` is a ref with no
consumer — it exists for a client-side export not yet written. Nesting the
watermark inside that node would mean the day someone wires up a rasterizer,
it silently starts appearing in the output. Keeping it outside makes §20's
guarantee a property of the DOM rather than of the current absence of an
exporter.

Two tests cover this: one states the structural rule, and one parses the real
`component-renderer.tsx` to confirm the component obeys it — without the
second, someone could nest the watermark and the first would keep passing.
Both were verified to fail when the watermark was moved inside.

### Housekeeping

`PaymentProvider` removed from `types/commerce.ts` — the mock-payment leftover
the plan identified, whose only implementation no longer exists.

---

## 3. Decisions made during implementation

These were not in the plan. Each was either confirmed with you at the time or is
recorded here as a judgement call for review.

| Decision | Choice | Reasoning |
|---|---|---|
| Where "hidden" lives | Static registry flag | Django's absence and Django being *down* are the same signal; inferring hiding from the backend would 404 the live product during a cold start. Cost: unhiding needs a deploy. **Confirmed with you.** |
| Withdrawn product entries | Kept, marked hidden | Reversible, translations survive. **Confirmed with you.** |
| `/waitlist` | Removed entirely | **Confirmed with you.** API route and Supabase client removed as dependents. |
| Site-wide `Meta.description` price | No price at all | Adding one means a Django call on every route including legal pages, for a description that page-level metadata overrides where price matters. |
| §3 concept name | `mounting`, not `frame` | The module already has a `frame` theme axis meaning decorative borders drawn into the artwork. |
| Edged margin | 0.5 inch | A standard frame rabbet covers ~¼ inch; 0.5in is double that, absorbing the lip plus positioning slack. **Derived from your "universal standard" answer.** |
| Edged margin colour | Palette background | **Your answer** — makes the print work against any frame the customer owns. Consequence: it is a safe margin, not a visible mat. |
| Decorative frame vs safe margin | Frame draws *inside* the margin | Otherwise the decorative border is the thing the picture frame covers. |
| Orientation | Portrait everywhere, via a per-layout lookup | All five layouts are the same vertical column; no wide composition exists. The indirection means adding one later is a one-line change. **Recommendation you accepted.** |
| Poster resolution | Base size, 150dpi at 24×36 | 24×36 at 300dpi is 78 megapixels (~311MB uncompressed), past what a browser canvas reliably produces. Normal practice at that viewing distance. |
| Legacy target ids | Retained everywhere | Entitlements record `target_id` at purchase; removing them breaks re-downloads of existing orders. |
| Upload MIME type | Detected overrides declared | Serving content under a header its bytes contradict is a sniffing hazard. |
| Project data ceiling | 256KB, whole-document | Per-field limits would require the backend to understand product shapes. |

---

## 4. Bugs found that were not in the plan

Listed because several were live and customer-facing.

1. **The product page promised "a print-ready PDF at 300 DPI."** No PDF exists
   anywhere in the pipeline — the renderer's own docstring says so. Fixed in
   three locales; a test now fails if any locale claims a PDF again.

2. **The order downloads list rendered raw internal target ids.** A customer who
   had just paid saw a row labelled `print-png`. This is the §2 problem, and it
   was live.

3. **Two of the three product FAQ answers were false.** They said photo support
   "is part of what is still being finished" (the schema has
   `{ id: "photo", type: "image" }` per milestone) and that the product "is still
   in the studio — join the waitlist" (it is on sale; the waitlist is gone). That
   text rendered on the page *and* fed the FAQPage JSON-LD, so it went to Google.

4. **The upload test fixture was `b"\x00" * 1024` labelled `image/jpeg`**, and it
   passed validation untouched. The project's own suite was exercising the upload
   pipeline with bytes no decoder would accept — §22a's gap, made concrete.

5. **The delivered HTML keepsake hardcoded `<html lang="en">` with no `dir`.**
   A French or Arabic customer received a keepsake declaring the wrong language
   and laid out left-to-right. **Fixed** — see "Locale" below.

6. **`Product` and `CollectionPage` JSON-LD emitted a literal message key.**
   Self-inflicted during §13: turning `meta.description` into a template broke
   callers that had no reason to change, and next-intl returns the key path
   rather than throwing. Google would have received
   `Products.loveStoryTimeline.meta.description` as the product description.
   Caught in the following pass; a test now scans for bare templated calls.

7. **`robots.txt` trailing slashes matched nothing.** `Disallow: /en/create/`
   prefix-matches `/en/create/anything` but not `/en/create` itself. Caught by
   reading the generated file rather than trusting the generator.

8. **`/products` was being statically prerendered**, so the priceless meta
   description would have been baked into the shell on every deploy — the
   storefront's main listing page quietly losing its price in search results,
   with nothing failing.

9. **The stale price was wrong in both directions** — copy said "from $12 USD"
   while the cheapest live pack is $8.

10. **The first Merchant Center feed came out empty.** The list endpoint carries
    no delivery packs and launch products hold no static offerings, so a
    list-only product has nothing to price. A test now asserts this, so the
    route's hydration step cannot be dropped silently.

---

## 5. Open decisions — blocking work

**French and Arabic review.** Roughly 30 unreviewed strings per locale, across
§11, §13, §14, §2 and §16b — including a full sizes-and-formats section with
phrasing like "montage sur verre ou acrylique." Much cheaper to review in one
pass than to unpick later.

---

## 6. Caveats and known gaps

**No Postgres in the working environment**, so database-backed backend tests have
not been run. The tests added for §2, §3 and §22 are deliberately database-free
and do pass, and they exercise `render_png` and the validators directly — but the
wider Django suite needs a run on a machine with a database before deploying.

**Merchant Center feed has two launch blockers**, both documented in
`merchant-feed.ts`:
- every product's `ogImage` is `null` (tracked §32 gap), so the only image the
  feed can reference is the generated OG card, which is a branded marketing
  graphic — exactly what Merchant Center's image policy rejects
- all items link to the same product page; automated price-match checks often
  read the prominent "from" figure and flag the rest. The fix if it happens is a
  per-pack landing URL, not a change to the prices, which are Django's

**`OrderPricing` and `Entitlement` in `types/commerce.ts` are unreferenced** but
were left in place — they are not mock-payment leftovers and may be intended API
shapes. Flagged for your call rather than deleted.

---

## 7. What remains

**Blocked on decisions above:** §16a, the rest of §16b, §5.

**Not started, in rough order of customer impact:**

- **§4 Wallpaper Pack** — per-device renders; would also migrate the wallpaper
  pack off legacy targets and likely collect the ESLint debt.
- **§18 Bonus deliverables**
- **§16c Gift-intent landing pages** — new page type, heavy on new copy in three
  locales.
- **§8 Order/payment reconciliation**
- **§7a–7d Internal Ops Dashboard** and **§9 dashboard architecture** — the
  largest remaining body of work.
- **§21 AR Pack system**, **§19 AR/VR direction** — future.

**Deferred, unchanged:** §6 (which pack the Sandbox order bought), homepage
caching strategy.
