# Project Status

> **Hosting note (updated):** Railway and Vercel are no longer used; development
> is local Docker and production is planned as a VPS running the same setup
> (database undecided). This matrix is a dated record.

Honest about what has and has not been verified against real services.

## Status matrix

| Area | Status | Evidence | Remaining action |
|---|---|---|---|
| Frontend app | **Complete** | 114 tests, 0 type errors, build passes | — |
| Routes (19) | **Complete** | All render; see `FRONTEND-ROUTES.md` | Exclude customer-flow from crawling (optional) |
| SEO metadata | **Complete** | Per-page canonicals, hreflang + x-default, OG, Twitter, 3 OG-image routes | Fix hardcoded "$12" meta descriptions |
| Sitemap / robots | **Implemented** | `app/sitemap.ts`, `app/robots.ts` | robots comment is stale (defect D1) |
| Structured data | **Implemented** | Product, Offer/AggregateOffer, BreadcrumbList, WebSite, Organization, Brand, FAQPage, ItemList, CollectionPage, ContactPoint | Optional per-product FAQ schema |
| AI discoverability | **Implemented (eligibility only)** | See `SEO-AND-AI-DISCOVERABILITY.md` | No guarantee is possible |
| Backend | **Complete** | 359 tests, `check` clean | — |
| Database | **Complete** | 8 tables, migrations clean, no drift | — |
| Catalog | **NOT POPULATED** | Production DB empty | Enter 9 rows (`CATALOG-GUIDE.md`) |
| Paddle integration | **Code complete, LIVE UNVERIFIED** | Django webhook half verified with signed payloads | Live Sandbox purchase |
| R2 | **Code complete, EXTERNALLY UNVERIFIED** | All tests used `MockAssetStorage` | Run the probe |
| Hosting | **Changed** | Railway and Vercel are no longer used; production is planned as a VPS running the Docker setup (database undecided) | Build and document the VPS deploy |
| Delivery | **Complete, locally verified** | Real ZIP, 21,131 bytes, real rendered PNGs; unpaid 404, cross-guest 403, anon 401 | Verify against real R2 |
| Localization | **Complete** | 41/41/41 shell keys; EN/FR/AR + RTL verified on marketing and Studio | Verify checkout/download in AR |
| Tests | **Passing** | FE 114 (+24 skipped), BE 359, live-integration 44 | — |
| Build | **Passing** | `next build` clean | — |
| Step 11 | **IMPLEMENTATION COMPLETE / LIVE PADDLE VERIFICATION PENDING** | Django half proven | Live test |
| Step 12 | **COMPLETE** | ZIP delivery + download UI | — |
| Step 12A | **COMPLETE** | Copy/localization | — |
| Step 12B | **SPECIFIED, NOT EXECUTED** | No operator access | Deploy |
| Step 13 | **NOT STARTED** | — | After 12B |

## Discovered defects — reported, NOT modified

**D1 — stale robots.txt scope.** `app/robots.ts` disallows only `/api/`, with
a comment saying the Studio route doesn't exist yet. It does.
`/create`, `/studio`, `/project`, `/orders` are crawlable. *Severity: low.*
Not a data leak — every one is session-gated server-side — but `/orders/<id>`
should never be indexable. *Action: add disallow entries or per-page
`robots: { index: false }`.*

**D2 — meta descriptions hardcode "From $12 USD".** 8 EN, 8 FR, 6 AR.
Factually wrong since the floor is $8. *Severity: low, SEO-only.*
*Action: parameterise, or correct the number.*

**D3 — `manage.py` defaults to development settings.** `wsgi.py` defaults to
production but `manage.py` does not, and the start command (as it was on Railway) uses
`manage.py`. Without `DJANGO_SETTINGS_MODULE`, `collectstatic` writes no
manifest and every admin page 500s under production. *Severity: **high** —
blocks catalog entry.* *Action: set the env var (config only; verified).*

**D4 — over-limit uploads through the proxy.** An 11 MB upload returns 500
after ~30 s instead of Django's 400, because Django rejects and closes while
the proxy is still streaming. *Severity: low* — the client-side guard
prevents it in practice. *Action: optionally have Django drain the body.*

**D5 — two ESLint `setState`-in-effect errors** in `use-studio-session.ts`
and `use-delivery-packs.ts`. *Severity: cosmetic.* Note: the second was
introduced by Step 9 code, so the earlier "defer until reworked" rationale
no longer applies.

**D6 — dead `PaymentProvider` type** in `types/commerce.ts` referencing
`simulate`. Imported by nothing. *Severity: none.* *Action: delete when
convenient.*

**D7 — Studio uses physical CSS properties** (`border-r`, `right-4`) where
Landing uses logical ones, so the Arabic Studio sidebar border sits on the
Latin side. *Severity: cosmetic, pre-existing.*

**D8 — no transactional email.** Copy no longer promises one (fixed in 12A),
but a customer who loses their session and their order link has no recovery
path. *Severity: medium, product-level.* *Action: decide whether to add
transactional email post-launch.*

**D9 — no git repository.** All audits have been ZIP diffs.
*Action: `git init` before Step 13.*

**D10 — TypeScript drift.** `npm install` pulls 6.0.3 despite `^5.7.2`.
*Action: use `npm ci`, or pin exactly.*

**D11 — rate limiting is in-memory per process.** Known backend limitation;
weaker once scaled beyond one worker.

## Unexplained event — Step 8

Ten files implementing Step 8 appeared on disk that I did not author. They
failed typecheck and all 9 asset integration tests. Every line was
subsequently reviewed, three defects fixed, and the result verified. That
diff warrants a closer read than the rest of the project.
