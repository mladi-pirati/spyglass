import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { uploadSessions } from "@/db/schema";
import { accessErrorResponse, requireSpyglassAccess, SpyglassAccessError } from "@/lib/auth/access";
import { errorDiagnostics } from "@/lib/error-diagnostics";
import { assertSameOrigin } from "@/lib/http";
import { uploadPart } from "@/lib/s3";
import { limitPartBody, UploadPartSizeError } from "@/lib/upload-part-body";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string; partNumber: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireSpyglassAccess();
    const { id, partNumber: rawPartNumber } = await context.params;
    const sessionId = z.string().uuid().parse(id);
    const partNumber = Number(rawPartNumber);
    const session = await db.query.uploadSessions.findFirst({ where: and(
      eq(uploadSessions.id, sessionId),
      eq(uploadSessions.createdByHelmId, actor.id),
      eq(uploadSessions.status, "pending"),
    ) });
    if (!session || session.expiresAt < new Date()) {
      return Response.json({ error: { code: "not_found", message: "Pending upload was not found." } }, { status: 404 });
    }

    const partCount = Math.ceil(session.byteSize / session.partSize);
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
      return Response.json({ error: { code: "invalid_part", message: "Part number is outside this upload." } }, { status: 422 });
    }
    const expectedSize = Math.min(session.partSize, session.byteSize - (partNumber - 1) * session.partSize);
    const declaredSize = request.headers.get("content-length");
    if (!request.body || (declaredSize !== null && Number(declaredSize) !== expectedSize)) {
      return Response.json({ error: { code: "invalid_part_size", message: "Upload part size does not match the session." } }, { status: 422 });
    }

    const body = Readable.from(limitPartBody(request.body, expectedSize));
    const etag = await uploadPart(session.storageKey, session.s3UploadId, partNumber, body, expectedSize);
    return Response.json({ partNumber, etag }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SpyglassAccessError) return accessErrorResponse(error);
    if (error instanceof UploadPartSizeError) {
      return Response.json({ error: { code: "invalid_part_size", message: "Upload part size does not match the session." } }, { status: 422 });
    }
    console.error("[uploads] part failed", { requestId, ...errorDiagnostics(error) });
    return Response.json(
      { error: { code: "internal_error", message: `Unexpected server error. Reference: ${requestId}.` } },
      { status: 500, headers: { "X-Request-ID": requestId } },
    );
  }
}
