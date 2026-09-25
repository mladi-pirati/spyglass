import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, uploadSessions } from "@/db/schema";
import { accessErrorResponse, requireSpyglassAccess } from "@/lib/auth/access";
import { assertSameOrigin } from "@/lib/http";
import { abortMultipartUpload, listUploadedParts } from "@/lib/s3";

export const runtime = "nodejs";

async function getOwnedSession(id: string, actorId: string) {
  return db.query.uploadSessions.findFirst({ where: and(eq(uploadSessions.id, id), eq(uploadSessions.createdByHelmId, actorId)) });
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteParams) {
  try {
    const actor = await requireSpyglassAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const session = await getOwnedSession(id, actor.id);
    if (!session || session.expiresAt < new Date()) return Response.json({ error: { code: "not_found", message: "Upload was not found." } }, { status: 404 });
    const parts = session.status === "pending" ? await listUploadedParts(session.storageKey, session.s3UploadId) : [];
    return Response.json({
      id: session.id, itemId: session.itemId, name: session.requestedName,
      byteSize: session.byteSize, partSize: session.partSize,
      partCount: Math.ceil(session.byteSize / session.partSize), status: session.status,
      expiresAt: session.expiresAt.toISOString(), fingerprint: session.fingerprint, parts,
    });
  } catch (error) { return accessErrorResponse(error); }
}

export async function DELETE(request: Request, context: RouteParams) {
  try {
    assertSameOrigin(request);
    const actor = await requireSpyglassAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const session = await getOwnedSession(id, actor.id);
    if (!session || session.status !== "pending") return Response.json({ error: { code: "not_found", message: "Pending upload was not found." } }, { status: 404 });
    await abortMultipartUpload(session.storageKey, session.s3UploadId);
    await db.transaction(async (tx) => {
      const [claimed] = await tx.update(uploadSessions).set({ status: "aborted", updatedAt: new Date() }).where(and(eq(uploadSessions.id, id), eq(uploadSessions.status, "pending"))).returning({ id: uploadSessions.id });
      if (!claimed) return;
      await tx.insert(auditEvents).values({
        actorType: "helm-user", actorHelmId: actor.id, action: "upload.aborted",
        targetId: session.itemId, targetType: "upload", targetName: session.requestedName,
        correlationId: session.id, context: { storageKey: session.storageKey },
      });
    });
    return new Response(null, { status: 204 });
  } catch (error) { return accessErrorResponse(error); }
}
