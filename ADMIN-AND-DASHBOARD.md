# Admin & Dashboard

There are **two separate staff surfaces**, deliberately split, not one
"admin dashboard":

1. **Django admin** (`/admin/`) — catalog and pricing entry only
2. **Ops screens** (`/api/v1/ops/*`) — order operations: lookup, Paddle
   reconciliation, revenue reports

Both sit behind the same login (Django's standard `is_staff` session
auth) but exist for different reasons and expose different data.

## 1. Django admin — `/admin/`

Create a staff user first: `python manage.py createsuperuser`.

**Registered:** `Product`, `DeliveryPack`, `Occasion`, `PrintSize` — the
catalog and pricing tables. This exists for one bounded reason: entering
a launch catalog into a fresh database was decided to happen through
hand-entry here rather than a seed migration.

**Deliberately NOT registered:** `Customer`, `Project`, `Asset`, `Order`,
`Payment`, `Entitlement` — every piece of transactional, customer-owned
data. This is a documented scope decision (see the docstring at the top
of `apps/products/admin.py`), not an oversight: a staff UI over real
customer/order data is a separate decision with its own audit and privacy
questions, and shouldn't be granted as a side effect of needing to type in
a price. That's what the ops screens below are for instead — purpose-built,
narrower, and specifically scoped to what staff actually need to do with
an order.

**The one piece of real validation logic here:** `DeliveryPack`'s admin
form validates `included_targets` (a free-form JSON array) against what
the product's registered renderer can actually produce. Without it, a
typo (`"landscpae-png"`) or a genuinely unsupported target saves fine,
sells fine, charges fine via Paddle, and only surfaces as a 501 error when
a customer who has already paid tries to download it.

## 2. Ops screens — `/api/v1/ops/*`

All behind `staff_member_required` (redirects an anonymous visitor to the
admin login — same session, same staff flag, no separate auth system).

| Screen | URL | What it's for |
|---|---|---|
| Status | `/api/v1/ops/status/` | Health of five services at a glance. R2 and Paddle show **unknown**, not red, when genuinely unconfigured (e.g. local dev using the mock providers) — this distinction matters, since a red "down" reading for something that was never supposed to be configured is noise that trains people to ignore real alerts |
| Status (JSON) | `/api/v1/ops/status.json` | Same data, machine-readable — for `check_services`' Telegram alerting |
| Lookup | `/api/v1/ops/lookup/` | Search by customer email or a **partial** order id. The real reason this screen exists: distinguishing "paid and delivered" from **"PAID — but nothing was delivered"** (shown in red) — the second is a real, distinct failure mode (payment succeeded, entitlement-granting didn't) that support needs to see immediately, not infer from a blank downloads list |
| Reconcile | `/api/v1/ops/reconcile/` | Search an order, see Paddle's own transaction candidates side by side, confirm the match by hand. Exists for the case where the webhook never arrived or arrived malformed — the payment is real on Paddle's side but Django never heard about it |
| Reports | `/api/v1/ops/reports/` | Revenue, pack breakdown, new vs. returning customers, unpaid rate |

**The lookup screen's real test** (also in `TESTING-RUNBOOK.md`): find a
paid order, confirm it says "Paid and delivered." Then, in the Django
admin, delete its entitlements directly and search again — it must now
say "PAID — but nothing was delivered," in red. That specific failure
mode is the entire reason this screen exists; if it doesn't distinguish
the two states, it isn't doing its job.

## Alerting

`python manage.py check_services` runs the same health checks as the
status screen and sends a Telegram alert only when a service's state
*changes* (not on every run — that would make the alert channel useless
noise). Needs `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` set; blank disables
it entirely, silently. Run with `--no-alerts` to see the checks without
sending anything. Should run on a schedule (every 5–15 minutes is
reasonable) — see `DEPLOYMENT-GUIDE-DOCKER.md`'s scheduled-job section.
