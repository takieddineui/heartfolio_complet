/**
 * The FAQ question keys, shared between the visible FAQ section (a client
 * component, for its search/accordion state) and the homepage's FAQPage
 * structured data (rendered server-side, §16a/§29).
 *
 * THIS FILE HAS NO "use client" DIRECTIVE, AND THAT IS THE ENTIRE REASON IT
 * EXISTS SEPARATELY FROM `faq.tsx`.
 *
 * `FAQ_KEYS` used to live inside `faq.tsx`, which is a client component. A
 * Server Component importing a plain value from a `"use client"` module
 * hits a real Next.js RSC boundary: only the component reference survives
 * into the server bundle, not arbitrary data exports. On the server,
 * `HOMEPAGE_FAQ_KEYS` was not the array — it was whatever the RSC compiler
 * substitutes for a non-component export of a client module — and calling
 * `.map()` on it threw `TypeError: ... .map is not a function`, SSR-only,
 * which is exactly what only-happens-on-/en-and-/fr looks like.
 *
 * The fix is where the data lives, not a guard at the call site. Wrapping
 * the call in `Array.isArray(...)` would have hidden the FAQ schema
 * silently going empty in production instead of fixing the actual cause.
 */
export const FAQ_KEYS = [
  "whatIs",
  "receive",
  "choose",
  "preview",
  "printing",
  "sizing",
  "mistake",
  "access",
] as const;
