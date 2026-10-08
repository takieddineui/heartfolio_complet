# Studio Integration Guide (documentation only — nothing here is built yet)

This describes how the Studio app — built later, as its own independent
project — should connect back to this Marketing App. Nothing in this
document changes the Marketing App; it's a plan for when the Studio app
exists.

---

## 1. Recommended project structure (two repos, one org)

```
heartfolio-marketing/     ← this project, as it exists after this refactor
  src/lib/products/       ← Product Registry (source of truth — see §3)
  src/messages/           ← Marketing copy translations

heartfolio-studio/        ← new, independent Next.js project (built later)
  src/lib/products/       ← consumes the registry (see §3 — does not
                             redefine it)
  src/components/studio/  ← everything we removed from Marketing in this
                             refactor moves here almost unchanged:
                             studio-context, toolbar, sidebar, canvas,
                             preview renderers, checkout/processing/
                             download/thank-you flow
```

Two separate Next.js apps, two separate deployments (e.g.
`heartfolio.com` and `studio.heartfolio.com`), sharing code via the
mechanisms below rather than being one monorepo build — simplest to reason
about, and matches "the Studio will become its own application" from the
original brief.

If deploy velocity later justifies it, a pnpm/turborepo monorepo with
`packages/design-system`, `packages/product-registry`, `apps/marketing`,
`apps/studio` is the natural next step — but that's an optimization, not
a requirement to start.

---

## 2. How the two apps communicate

**Navigation, not API calls.** The Marketing App's Create page is where a
person picks a product; once `status === "available"`, the Continue
button should link straight to the Studio app with the product identified
in the URL:

```
https://studio.heartfolio.com/create/star-map?ref=marketing
```

`getContinueDestination()` in `src/lib/products/registry.ts` is already
the single place this URL gets built — when the Studio app exists, that
function's `"available"` branch is the only line that changes (swap the
placeholder `/studio-placeholder/...` href for the real Studio app's
absolute URL).

No server-to-server API is needed for this hand-off — it's a plain link,
same as any external referral, which keeps the two apps genuinely
decoupled.

---

## 3. Sharing the Product Registry

The registry (`src/lib/products/{types,registry}.ts`) must not be
hand-copied into the Studio app and maintained twice — that guarantees
drift. Two realistic options, in order of recommendation:

**Option A — npm package (recommended to start).**
Publish `src/lib/products/*` as a small private package
(`@heartfolio/product-registry`) to GitHub Packages or a private npm
registry. Both apps `npm install` it. Updating a product means bumping
the package version and updating it in both apps — slightly manual, but
zero infrastructure, and a natural stepping stone to Option B.

**Option B — a small registry service.**
Once products change often enough that the manual bump in Option A gets
annoying, move `PRODUCT_REGISTRY` behind a tiny read API (could be as
simple as a Supabase table + a cached fetch, reusing the same Supabase
project already introduced for the waitlist in this refactor). Both apps
fetch from it at build time (ISR) or request time. This is also the
natural moment to localize product content properly (see the scoping
note in `DESIGN_SYSTEM.md` §9) — a database table naturally supports
per-locale columns/rows in a way a hardcoded `.ts` array doesn't.

Either way: the `ProductEntry` **type** (`types.ts`) is the real contract.
Keep it stable; both apps import it.

---

## 4. Sharing language (locale)

Pass the current locale through the same URL hand-off:

```
https://studio.heartfolio.com/fr/create/star-map
```

The Studio app should run its own `next-intl` setup (it's a fully separate
Next.js app, so it needs its own `routing.ts`/`navigation.ts`/message
files) — but it should read the **incoming path's locale segment** on
first load and default to that, rather than re-detecting geo/
Accept-Language independently, so a French visitor doesn't get bounced
back to English mid-flow.

---

## 5. Sharing theme (light/dark)

`ThemeProvider` persists to `localStorage` under `heartfolio-theme`.
If both apps are on the same top-level domain (e.g.
`heartfolio.com` / `studio.heartfolio.com`), **`localStorage` does not
share across subdomains** — that's a browser limitation, not a code
choice. Two options when this matters:

- **Simplest**: each app remembers its own theme choice independently
  (copy `ThemeProvider` as-is into the Studio app, per
  `DESIGN_SYSTEM.md` §10). A returning visitor picks their preference
  once per app — mildly imperfect, zero extra infrastructure.
- **If cross-app sync is worth the complexity**: pass the current theme
  as a query param on the hand-off link (`?theme=dark`) so the Studio
  app's `ThemeProvider` initializes from it instead of its own
  `localStorage` read, then continues to manage state independently
  from that point.

---

## 6. Sharing authentication (future)

Not implemented anywhere yet (no accounts exist in the Marketing App
today — the waitlist form is anonymous/email-only). When accounts are
needed (almost certainly once the Studio app has real checkout + "my
projects"):

- Use one auth provider shared by both apps (Supabase Auth is a natural
  fit, since Supabase is already the waitlist's storage — see the
  waitlist implementation this refactor added) issuing a session/JWT
  valid across both subdomains via a shared-domain cookie
  (`Domain=.heartfolio.com`).
- The Marketing App likely never needs to *require* login (browsing
  products, joining the waitlist should stay frictionless) — auth is a
  Studio-app concern that the Marketing App only needs to pass through
  (e.g. an already-authenticated user's session cookie is simply present
  when they land on the Studio app, nothing the Marketing App has to
  actively do).

---

## 7. Where Checkout and Download fit in the future architecture

Both were fully built once already (in this project's history, before
this refactor) and are a reasonable starting point to port into the new
Studio app almost unchanged:
- Checkout: payment-method selection + order summary UI, computing a
  total from a product's base price and any selected paid add-ons
  (sizes beyond an included count, premium modules, etc.).
- Download: order number + download code generation, file delivery.

Recommended shape in the Studio app: `Studio → Checkout → Processing →
Download → Thank You`, exactly the flow this Marketing App used to have,
now living entirely in the Studio app's own routes. The Marketing App
never re-implements any of this — its job stops at the waitlist (for
`waitlist`-status products) or the hand-off link (for `available`-status
products).

---

## 8. Minimal-change checklist for when the Studio app is ready

1. Deploy the Studio app at its own domain/subdomain.
2. In `src/lib/products/registry.ts` (Marketing App), update
   `getContinueDestination()`'s `"available"` branch to point at the real
   Studio app URL instead of the placeholder.
3. Flip the relevant `ProductEntry.status` from `"waitlist"` to
   `"available"` for each product as it actually ships.
4. Nothing else in the Marketing App changes — this is the entire point
   of driving navigation off `status` rather than hardcoded links.
