/**
 * THE DJANGO ORIGIN THE SERVER TALKS TO — REQUIRED, WITH NO DEFAULT.
 *
 * Read by `next.config.ts` (the `/api/backend/*` rewrite), `catalog-server.ts`
 * and the live keepsake page. All three used to carry their own copy of
 * `process.env.BACKEND_API_ORIGIN || "<a hardcoded Railway URL>"`. Railway is
 * no longer used, so an unset variable silently pointed the storefront at the
 * wrong backend — and in a Docker build froze that into
 * `.next/routes-manifest.json` for good, with no error anywhere. A silent
 * fallback to a dead host is worse than an explicit error, so there is no
 * fallback: unset means this throws, naming the variable.
 *
 * AN EMPTY OR WHITESPACE VALUE COUNTS AS UNSET. A Docker ARG with no default
 * and no `--build-arg` becomes an empty string once copied into an ENV — never
 * `undefined` — and that case once produced an origin-less rewrite destination
 * (`/api/v1/:path*`, no host at all).
 *
 * CALL IT OUTSIDE ANY `try/catch` THAT DEGRADES GRACEFULLY. The catalog layer
 * turns every error inside its `try` into "Django is unreachable" and serves a
 * cached or registry-only storefront; the live page turns every error into a
 * 404. Both are right for an outage and wrong for a missing setting, which
 * would be dressed up as one. Resolve the origin first, so this surfaces as the
 * configuration error it is.
 *
 * Server-side only: the browser never learns this origin (it calls the
 * same-origin `/api/backend/*` path instead).
 */

export class BackendOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendOriginError";
  }
}

const HOW_TO_SET =
  "Set it to the Django backend's origin, with no path: http://localhost:8000 for local development, " +
  "http://api:8000 under docker compose, or the backend's address on the VPS in production. " +
  "There is deliberately no default.";

export function getBackendOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.BACKEND_API_ORIGIN?.trim();

  if (!raw) {
    throw new BackendOriginError(`BACKEND_API_ORIGIN is not set (or is empty). ${HOW_TO_SET}`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BackendOriginError(`BACKEND_API_ORIGIN is not a valid URL: "${raw}". ${HOW_TO_SET}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BackendOriginError(
      `BACKEND_API_ORIGIN must start with http:// or https://, got "${raw}". ${HOW_TO_SET}`
    );
  }

  return raw;
}
