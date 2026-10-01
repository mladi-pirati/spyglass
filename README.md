# Spyglass

Spyglass is the shared internal media library for Helm members assigned to the Spyglass application. Content lives in private S3 storage, while folder metadata, upload state, cleanup jobs, and the immutable audit log live in PostgreSQL.

## Local development

Copy `.env.example` to `.env`, fill in Keycloak, Helm, and S3 credentials, and use the same `SPYGLASS_HELM_SHARED_SECRET` in Helm and Spyglass.

```bash
docker compose up -d db
bun install
bun run db:migrate
bun run dev
```

Spyglass runs on the URL in `AUTH_URL` (the example uses port 3003). Helm must be reachable at `HELM_API_URL`, and its Spyglass application must use the same Keycloak client ID configured here.

Useful commands:

```bash
bun run db:generate
bun run db:migrate
bun run db:studio
bun test
bun run lint
bun run build
```

## Storage and uploads

The browser sends 64 MiB parts to authenticated Spyglass routes. The app streams each part to private S3; S3 addresses and credentials never reach the browser. Uploads are capped at 10 GB and resumable sessions last 24 hours. Reads also pass through the authenticated Next.js content route; the bucket must not be public.

If starting an upload returns a 500, the response includes a reference ID. Find the matching `[uploads] start failed` entry in the **app** logs. Its `stage` identifies whether origin validation, destination lookup, S3 multipart creation, or database persistence failed; `code` and `httpStatusCode` provide the underlying error category. The worker does not handle upload creation.

The reverse proxy must allow request bodies of at least 64 MiB and keep upload requests open long enough for the app to stream them to S3. Its upload traffic and outbound S3 traffic both pass through the app server.

Objects use readable upload-time keys such as `library/public_relations/siska_promo/campaign--1234abcd.jpg`. Folder and filename segments are lowercase ASCII, underscore-delimited, and capped at 80 readable characters. Renaming or moving an item changes database metadata only; existing S3 keys remain stable. Replacements get a new `--vN` key and the old object is queued for deletion after the database swap succeeds.

## Lifecycle worker

The `worker` Compose service aborts expired multipart uploads, retries queued S3 deletions, and permanently purges items after 30 days in trash. Every lifecycle mutation emits a system audit event. Run it without Compose with:

```bash
bun run worker
```

Production should run exactly one worker instance with the web application and PostgreSQL migrations deployed first.

## Authorization and audit

Every protected page and route revalidates the current member through Helm and confirms that Spyglass remains assigned. All authorized members share the same library permissions. Audit access is recalculated from Helm on every request: only members with the role having the smallest numeric priority can open `/audit`.

Helm exposes only `{ key, name, priority }` from `GET /api/internal/spyglass/roles`. The route is server-to-server only, requires the shared bearer secret, has no browser CORS, and is always uncached.

Audit rows are written in the same database transaction as their mutation. A PostgreSQL trigger rejects updates and deletes, and events are retained indefinitely. Logs intentionally exclude credentials, presigned URLs, email addresses, and file contents.
