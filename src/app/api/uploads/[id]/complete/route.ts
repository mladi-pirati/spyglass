import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, itemClosure, items, storageDeletionJobs, uploadSessions } from "@/db/schema";
import { accessErrorResponse, requireSpyglassAccess } from "@/lib/auth/access";
import { assertSameOrigin } from "@/lib/http";
import { completeMultipartUpload, inspectStoredObject } from "@/lib/s3";

const inputSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).min(1).max(10_000),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let completedObject: { itemId: string; storageKey: string; correlationId: string } | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireSpyglassAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_request", message: "Invalid completed parts." } }, { status: 422 });
    const session = await db.query.uploadSessions.findFirst({ where: and(eq(uploadSessions.id, id), eq(uploadSessions.createdByHelmId, actor.id), eq(uploadSessions.status, "pending")) });
    if (!session || session.expiresAt < new Date()) return Response.json({ error: { code: "not_found", message: "Pending upload was not found." } }, { status: 404 });
    const parts = parsed.data.parts.toSorted((a, b) => a.partNumber - b.partNumber);
    if (parts.some((part, index) => part.partNumber !== index + 1)) return Response.json({ error: { code: "invalid_parts", message: "Completed parts must be contiguous." } }, { status: 422 });

    await completeMultipartUpload(session.storageKey, session.s3UploadId, parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })));
    completedObject = { itemId: session.itemId, storageKey: session.storageKey, correlationId: session.id };
    const object = await inspectStoredObject(session.storageKey);
    if (object.byteSize !== session.byteSize) {
      await db.transaction(async (tx) => {
        await tx.update(uploadSessions).set({ status: "aborted", updatedAt: new Date() }).where(eq(uploadSessions.id, id));
        await tx.insert(storageDeletionJobs).values({ itemId: session.itemId, storageKey: session.storageKey, reason: "invalid-upload-size", correlationId: session.id });
        await tx.insert(auditEvents).values({ actorType: "helm-user", actorHelmId: actor.id, action: "upload.aborted", targetId: session.itemId, targetType: "upload", targetName: session.requestedName, correlationId: session.id, context: { reason: "size-mismatch", storageKey: session.storageKey } });
      });
      return Response.json({ error: { code: "size_mismatch", message: "Stored file size did not match the upload." } }, { status: 422 });
    }

    const item = await db.transaction(async (tx) => {
      if (session.intent === "new") {
        if (session.parentId) {
          const parent = await tx.query.items.findFirst({ where: and(eq(items.id, session.parentId), eq(items.kind, "folder"), isNull(items.trashedAt)) });
          if (!parent) throw new Error("Upload destination is no longer available.");
        }
        const [created] = await tx.insert(items).values({
          id: session.itemId, parentId: session.parentId, kind: "file", name: session.requestedName,
          mimeType: object.mimeType, byteSize: object.byteSize, storageKey: session.storageKey,
          storageEtag: object.etag, storageGeneration: session.generation, preview: object.preview,
          createdByHelmId: actor.id, updatedByHelmId: actor.id,
        }).returning();
        await tx.insert(itemClosure).values({ ancestorId: created.id, descendantId: created.id, depth: 0 });
        if (created.parentId) await tx.execute(sqlInsertAncestors(created.id, created.parentId));
        await tx.insert(auditEvents).values({ actorType: "helm-user", actorHelmId: actor.id, action: "file.uploaded", targetId: created.id, targetType: "file", targetName: created.name, correlationId: session.id, context: { parentId: created.parentId, byteSize: created.byteSize, mimeType: created.mimeType, storageKey: created.storageKey } });
        await tx.update(uploadSessions).set({ status: "completed", updatedAt: new Date() }).where(eq(uploadSessions.id, id));
        return created;
      }
      const current = await tx.query.items.findFirst({ where: and(eq(items.id, session.itemId), eq(items.kind, "file"), isNull(items.trashedAt)) });
      if (!current) throw new Error("Replacement target no longer exists.");
      const [updated] = await tx.update(items).set({
        mimeType: object.mimeType, byteSize: object.byteSize, storageKey: session.storageKey,
        storageEtag: object.etag, storageGeneration: session.generation, preview: object.preview,
        updatedAt: new Date(), updatedByHelmId: actor.id,
      }).where(eq(items.id, current.id)).returning();
      if (current.storageKey) await tx.insert(storageDeletionJobs).values({ itemId: current.id, storageKey: current.storageKey, reason: "replaced", correlationId: session.id });
      await tx.insert(auditEvents).values({ actorType: "helm-user", actorHelmId: actor.id, action: "file.replaced", targetId: current.id, targetType: "file", targetName: current.name, correlationId: session.id, context: { previousStorageKey: current.storageKey, storageKey: session.storageKey, generation: session.generation, byteSize: object.byteSize, mimeType: object.mimeType } });
      await tx.update(uploadSessions).set({ status: "completed", updatedAt: new Date() }).where(eq(uploadSessions.id, id));
      return updated;
    });
    completedObject = null;
    return Response.json({ item });
  } catch (error) {
    if (completedObject) {
      await db.insert(storageDeletionJobs).values({
        ...completedObject,
        reason: "failed-completion",
      }).catch(() => undefined);
    }
    return accessErrorResponse(error);
  }
}

function sqlInsertAncestors(itemId: string, parentId: string) {
  return sql`insert into ${itemClosure} (ancestor_id, descendant_id, depth) select ancestor_id, ${itemId}, depth + 1 from ${itemClosure} where descendant_id = ${parentId}`;
}
