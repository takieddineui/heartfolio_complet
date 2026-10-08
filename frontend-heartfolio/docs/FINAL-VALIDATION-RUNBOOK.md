# Step 13 — Final Validation Runbook

Execute from your PC after deployment (`DEPLOYMENT-GUIDE.md`). Fill in the
Result column. **Do not treat automated test results as evidence for any row
here** — every one requires the real deployed system.

## Pre-flight

| # | Check | Expected | Result |
|---|---|---|---|
| P1 | `GET /api/v1/health/` | `{"status":"ok"}` | |
| P2 | `/admin/` | **styled** login (unstyled ⇒ `DJANGO_SETTINGS_MODULE`) | |
| P3 | `GET /api/v1/products/` | both products, correct prices | |
| P4 | R2 probe | prints `R2Storage`, round-trips bytes | |
| P5 | `POST /api/v1/webhooks/paddle/` with junk signature | **401** | |
| P6 | Paddle destination | URL with trailing slash, `transaction.paid` subscribed | |
| P7 | DevTools → Cookies after visiting Studio | `sessionid` on **your** domain | |

## Journey A — Love Story Timeline (EN)

| # | Action | Expected | Result |
|---|---|---|---|
| A1 | Home → product page | offerings show Django prices | |
| A2 | Personalize in Studio | preview updates; photo upload succeeds | |
| A3 | Pick a pack | left panel shows that pack's price | |
| A4 | Enter email, continue | progress states, then Paddle overlay | |
| A5 | Overlay | correct amount; email prefilled; theme matches | |
| A6 | Pay with Sandbox card | "Confirming your payment…" **then** success | |
| A7 | Backend logs | `paddle_webhook_received` → `paddle_webhook_payment_confirmed` | |
| A8 | Order in admin | `paid`; entitlements = pack targets, no duplicates | |
| A9 | Download pack | ZIP; contents match `included_targets` | |
| A10 | Open the PNGs | correct personalization, print resolution | |

Record: order id, `txn_…`, `evt_…`, entitlement count.

## Journey B — Where We Met (FR, then AR)

| # | Action | Expected | Result |
|---|---|---|---|
| B1 | `/fr/products/where-we-met` | French copy, Django prices, **no Digital card** | |
| B2 | Studio in French | labels French; map/coordinates work | |
| B3 | Checkout in French | French throughout | |
| B4 | Paddle overlay | **French** | |
| B5 | Complete purchase, download | ZIP with 2–4 PNGs per pack | |
| B6 | Repeat at `/ar/...` | Arabic + `dir="rtl"`; Studio usable | |
| B7 | Paddle overlay in AR | **English** — expected, Paddle has no Arabic | |
| B8 | AR success + download | Arabic copy; ZIP downloads | |

## Failure & security cases

| # | Action | Expected | Result |
|---|---|---|---|
| F1 | Close overlay without paying | order `pending`; 0 entitlements | |
| F2 | Refresh mid-payment | `/orders/<id>` shows pending; nothing granted | |
| F3 | Pay, close tab immediately | `/orders/<id>` reaches `paid` on its own | |
| F4 | Replay `transaction.paid` (Paddle → Replay) | 200; `duplicate_delivery`; counts unchanged | |
| F5 | Invalid signature (curl) | 401; order unchanged | |
| F6 | `GET /orders/<unpaid>/download/` | **404** | |
| F7 | Same in a different browser | **403** | |
| F8 | `GET /entitlements/<other guest's>/download/` | **403** | |
| F9 | Order a pack from the wrong product | `delivery_pack_not_found` | |
| F10 | Inspect ZIP | only purchased targets; no extra files | |
| F11 | Search response bodies for `X-Amz`/bucket name | absent | |

## Verdict

Only after every row above is PASS may the system be described as
end-to-end verified. A single FAIL in F1–F11 is a security finding, not a
cosmetic one.
