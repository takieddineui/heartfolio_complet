import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Locates the Django backend for tests that compare a frontend list against
 * its backend counterpart (mime types, journey ids, palette ids). Same
 * resolution order as `composition-parity.test.ts`, and the same rule: it
 * THROWS when nothing matches. A parity test that cannot find what it
 * compares against must fail, not skip - a skipped parity test reports drift
 * as green.
 */
export function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "apps", "delivery", "product_renderers"))) return candidate;
  }
  throw new Error(
    "Cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH to its root (the directory " +
      "containing manage.py). Tried: " + candidates.join(" | ")
  );
}
