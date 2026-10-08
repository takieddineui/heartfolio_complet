/**
 * The anti-flash inline script and the storage key it reads, kept apart
 * from `theme-provider.tsx` for the same reason `faq-keys.ts` was split
 * out of `faq.tsx` — this file has no "use client" directive, and that is
 * load-bearing, not incidental.
 *
 * `theme-provider.tsx` is a client component (it uses `useContext`,
 * `useSyncExternalStore`). The root layout — a Server Component — rendered
 * `NO_FLASH_SCRIPT` inside a `<Script beforeInteractive>` tag, reading it
 * from that client module. On the server, a plain data export of a
 * `"use client"` file does not survive into the server bundle as itself;
 * only the component reference does.
 *
 * THIS ONE WAS WORSE THAN THE FAQ BUG, NOT MERELY THE SAME SHAPE. The FAQ
 * case threw — `.map` on a non-array is a TypeError, loud, page 500s,
 * someone notices immediately. This one didn't throw: rendering `undefined`
 * as a `<Script>` child is valid React and produces nothing. The inline
 * anti-flash script tag was present in the HTML with no content — meaning
 * every production page load has been flashing the wrong theme before
 * hydration, silently, with no error anywhere to surface it.
 */

export const THEME_STORAGE_KEY = "heartfolio-theme";

export const NO_FLASH_SCRIPT = `
(function() {
  var theme = 'dark';
  try {
    if (localStorage.getItem('${THEME_STORAGE_KEY}') === 'light') theme = 'light';
  } catch (e) {}
  var el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.classList.toggle('dark', theme === 'dark');
})();
`;
