# Heartfolio frontend — Next.js.
#
# Uses Next's `standalone` output, which traces exactly the node_modules the
# app actually imports and copies only those. Without it the runtime image
# carries the full dependency tree including every build-only package.
#
# NODE 24 (LTS), the same in every stage (27 Oct 2026). It was node:20-slim,
# below what the dependencies declare (@supabase/* at runtime want >=22,
# jsdom ^24.15 or >=26), and `npm ci` failed outright once package-lock.json
# had been written by a newer npm on the host. The lockfile must be
# regenerated with THIS image's npm (CLAUDE.md, "Regenerate the lockfile"),
# and `engines` in package.json and `.nvmrc` name the same version.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, not
# read at runtime. They must be present here or the browser gets undefined —
# this is the difference between a Docker build and a PaaS build (Vercel, the
# former host), where the dashboard supplied them automatically.
#
# TWO ARGS WERE REMOVED BECAUSE NOTHING READS THEM ANY MORE:
#   * NEXT_PUBLIC_API_BASE_URL — the browser no longer calls the backend
#     origin directly. It calls the same-origin `/api/backend/*` path
#     (`NEXT_PUBLIC_API_BASE_PATH`), which `next.config.ts` rewrites
#     server-side to `BACKEND_API_ORIGIN`. That is a RUNTIME variable, set
#     on the container rather than baked in here.
#   * NEXT_PUBLIC_PADDLE_CLIENT_TOKEN — the client token now arrives in the
#     backend's response to `/orders/<id>/pay/`, so the frontend never
#     needs it at build time.
# Passing either one now does nothing at all, which is worse than failing.
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_PADDLE_ENVIRONMENT
ARG NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
ARG NEXT_PUBLIC_API_BASE_PATH
ARG NEXT_PUBLIC_FREEMIUS_ENABLED
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID \
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN=$NEXT_PUBLIC_PLAUSIBLE_DOMAIN \
    NEXT_PUBLIC_PADDLE_ENVIRONMENT=$NEXT_PUBLIC_PADDLE_ENVIRONMENT \
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=$NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN \
    NEXT_PUBLIC_API_BASE_PATH=$NEXT_PUBLIC_API_BASE_PATH \
    NEXT_PUBLIC_FREEMIUS_ENABLED=$NEXT_PUBLIC_FREEMIUS_ENABLED

# NOT a NEXT_PUBLIC_ value — this one is never inlined into the client
# bundle (next.config.ts's own comment: "server-side config... the
# browser never needs to know it"). It still has to be a build ARG,
# for a different reason than the four above: next.config.ts's
# rewrites() is resolved once, during this exact `next run build` step,
# and frozen into .next/routes-manifest.json — the standalone server
# this image ships never re-evaluates next.config.ts at boot or per
# request, only reads that frozen manifest. Without this, the value is
# empty during the image build and next.config.ts THROWS (BACKEND_API_ORIGIN
# has no default), failing the build with a message that names the variable.
# It used to fall back silently to a hardcoded Railway URL and freeze that
# into the manifest permanently, regardless of whatever correct value
# docker-compose.yml's `environment:` block supplied afterward at container
# runtime — confirmed directly, the hard way: every local request was actually
# reaching the then-production Railway backend, with no error and nothing in
# the local api container's access log.
#
# docker-compose.yml's web service deliberately sets this in BOTH
# `build.args` (for this) and `environment:` (still genuinely read at
# real per-request runtime, by catalog-server.ts and the live keepsake
# page — see docker-compose.yml's own comment on that block for why
# neither one makes the other redundant).
ARG BACKEND_API_ORIGIN
ENV BACKEND_API_ORIGIN=$BACKEND_API_ORIGIN

ENV DOCKER_BUILD=1
RUN npm run build


FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN useradd --create-home --uid 10001 heartfolio
USER heartfolio

COPY --from=builder --chown=heartfolio:heartfolio /app/.next/standalone ./
COPY --from=builder --chown=heartfolio:heartfolio /app/.next/static ./.next/static
COPY --from=builder --chown=heartfolio:heartfolio /app/public ./public

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
