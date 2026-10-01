# Node base with the bun binary: bun installs deps, but `next build` runs under
# node (bun 1.2.19 segfaults collecting page data when it runs Next itself).
FROM node:22-bookworm-slim AS base

COPY --from=oven/bun:1.2.19-slim /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

FROM base AS deps

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder

COPY . .

# Some modules read env at import time during build, but runtime values still
# come from the container environment.
RUN DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/spyglass \
    AUTH_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n')" \
    AUTH_URL=http://localhost:3000 \
    KEYCLOAK_CLIENT_ID=spyglass \
    KEYCLOAK_CLIENT_SECRET=build-placeholder \
    KEYCLOAK_ISSUER=https://keycloak.example.com/realms/build \
    HELM_API_URL=http://localhost:3000 \
    S3_REGION=build \
    S3_ENDPOINT=https://s3.example.com \
    S3_BUCKET=build \
    S3_ACCESS_KEY_ID=build \
    S3_SECRET_ACCESS_KEY=build \
    NEXT_TELEMETRY_DISABLED=1 \
    bun run build

FROM deps AS migrator

COPY . .
CMD ["bun", "run", "db:migrate"]

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
