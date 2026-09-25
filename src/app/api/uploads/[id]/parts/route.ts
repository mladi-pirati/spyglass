import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { uploadSessions } from "@/db/schema";
import { accessErrorResponse, requireSpyglassAccess } from "@/lib/auth/access";
import { assertSameOrigin } from "@/lib/http";
import { signUploadParts } from "@/lib/s3";

const inputSchema = z.object({ partNumbers: z.array(z.number().int().positive()).min(1).max(50) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireSpyglassAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_request", message: "Invalid part numbers." } }, { status: 422 });
    const session = await db.query.uploadSessions.findFirst({ where: and(eq(uploadSessions.id, id), eq(uploadSessions.createdByHelmId, actor.id), eq(uploadSessions.status, "pending")) });
    if (!session || session.expiresAt < new Date()) return Response.json({ error: { code: "not_found", message: "Pending upload was not found." } }, { status: 404 });
    const maxPart = Math.ceil(session.byteSize / session.partSize);
    const unique = [...new Set(parsed.data.partNumbers)];
    if (unique.some((part) => part > maxPart)) return Response.json({ error: { code: "invalid_part", message: "Part number is outside this upload." } }, { status: 422 });
    return Response.json({ parts: await signUploadParts(session.storageKey, session.s3UploadId, unique) });
  } catch (error) { return accessErrorResponse(error); }
}
