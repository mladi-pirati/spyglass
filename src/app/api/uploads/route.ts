import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, items, uploadSessions } from "@/db/schema";
import { accessErrorResponse, requireSpyglassAccess, SpyglassAccessError } from "@/lib/auth/access";
import { getFolderSegments, itemNameSchema } from "@/lib/drive";
import { errorDiagnostics } from "@/lib/error-diagnostics";
import { assertSameOrigin } from "@/lib/http";
import { buildStorageKey } from "@/lib/storage-path";
import { abortMultipartUpload, createMultipartUpload, MAX_FILE_SIZE, MULTIPART_PART_SIZE } from "@/lib/s3";

export const runtime = "nodejs";

const inputSchema = z.object({
  parentId: z.string().uuid().nullable().default(null),
  name: itemNameSchema,
  byteSize: z.number().int().positive().max(MAX_FILE_SIZE),
  contentType: z.string().trim().min(1).max(255).default("application/octet-stream"),
  fingerprint: z.string().trim().max(255).optional(),
  replaceItemId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let stage = "origin_check";
  let uploadId: string | undefined;
  let storageKey: string | undefined;
  try {
    assertSameOrigin(request);
    stage = "access_check";
    const actor = await requireSpyglassAccess();
    stage = "request_parse";
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_request", message: parsed.error.issues[0]?.message } }, { status: 422 });

    let itemId = crypto.randomUUID();
    let parentId = parsed.data.parentId;
    let name = parsed.data.name;
    let generation = 1;
    const intent = parsed.data.replaceItemId ? "replace" as const : "new" as const;

    stage = "destination_lookup";
    if (parsed.data.replaceItemId) {
      const current = await db.query.items.findFirst({ where: and(eq(items.id, parsed.data.replaceItemId), eq(items.kind, "file"), isNull(items.trashedAt)) });
      if (!current) return Response.json({ error: { code: "not_found", message: "File was not found." } }, { status: 404 });
      itemId = current.id;
      parentId = current.parentId;
      name = current.name;
      generation = current.storageGeneration + 1;
    } else {
      if (parentId) {
        const folder = await db.query.items.findFirst({ where: and(eq(items.id, parentId), eq(items.kind, "folder"), isNull(items.trashedAt)) });
        if (!folder) return Response.json({ error: { code: "invalid_parent", message: "Folder was not found." } }, { status: 404 });
      }
      const duplicate = await db.query.items.findFirst({ where: and(
        parentId ? eq(items.parentId, parentId) : isNull(items.parentId),
        sqlLowerName(name),
      ) });
      if (duplicate) return Response.json({ error: { code: "name_conflict", message: "An item with that name already exists here." } }, { status: 409 });
    }

    stage = "storage_key";
    storageKey = buildStorageKey({ folderSegments: await getFolderSegments(parentId), itemId, filename: name, generation });
    stage = "storage_create_multipart";
    uploadId = await createMultipartUpload(storageKey, parsed.data.contentType);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    stage = "session_persist";
    const [session] = await db.transaction(async (tx) => {
      const created = await tx.insert(uploadSessions).values({
        itemId, parentId, intent, requestedName: name,
        declaredMimeType: parsed.data.contentType, byteSize: parsed.data.byteSize,
        fingerprint: parsed.data.fingerprint, storageKey: storageKey!, s3UploadId: uploadId!,
        partSize: MULTIPART_PART_SIZE, generation, createdByHelmId: actor.id, expiresAt,
      }).returning();
      await tx.insert(auditEvents).values({
        actorType: "helm-user", actorHelmId: actor.id, action: "upload.started",
        targetId: itemId, targetType: "upload", targetName: name,
        correlationId: created[0].id,
        context: { intent, parentId, byteSize: parsed.data.byteSize, storageKey },
      });
      return created;
    });
    return Response.json({
      id: session.id, itemId, name, byteSize: session.byteSize,
      partSize: session.partSize, partCount: Math.ceil(session.byteSize / session.partSize),
      expiresAt: session.expiresAt.toISOString(), fingerprint: session.fingerprint,
    }, { status: 201 });
  } catch (error) {
    if (!(error instanceof SpyglassAccessError)) {
      console.error("[uploads] start failed", { requestId, stage, ...errorDiagnostics(error) });
    }
    if (uploadId && storageKey) {
      await abortMultipartUpload(storageKey, uploadId).catch((abortError) => {
        console.error("[uploads] cleanup failed", { requestId, stage: "storage_abort_multipart", ...errorDiagnostics(abortError) });
      });
    }
    if (!(error instanceof SpyglassAccessError)) {
      return Response.json(
        { error: { code: "internal_error", message: `Unexpected server error. Reference: ${requestId}.` } },
        { status: 500, headers: { "X-Request-ID": requestId } },
      );
    }
    return accessErrorResponse(error);
  }
}

function sqlLowerName(name: string) {
  return sql`lower(${items.name}) = lower(${name})`;
}
