/**
 * `server-only` exists to make a build fail if server code is imported into a
 * Client Component. Under Vitest's jsdom environment it resolves to that
 * guard and throws, so the alias in `vitest.config.mts` points here instead.
 * The guard still does its real job in `next build`; this only keeps it from
 * firing inside a test runner that is deliberately importing server modules.
 */
export {};
