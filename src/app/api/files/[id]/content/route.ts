import { z } from "zod";

import { accessErrorResponse, requireSpyglassAccess } from "@/lib/auth/access";
import { getBreadcrumbs, getItem } from "@/lib/drive";
import { contentDisposition, isSatisfiableSingleRange } from "@/lib/http";
import { getStoredObject, headStoredObject } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

async function resolveFile(context: RouteParams) {
  await requireSpyglassAccess();
  const id = z.string().uuid().parse((await context.params).id);
  const item = await getItem(id);
  if (!item || item.kind !== "file" || !item.storageKey) return null;
  const path = await getBreadcrumbs(id);
  if (path.some((part) => part.trashedAt !== null)) return null;
  return item;
}

function headersFor(item: NonNullable<Awaited<ReturnType<typeof resolveFile>>>, input: {
  contentLength?: number; contentRange?: string; etag?: string; lastModified?: Date; download: boolean;
}) {
  const attachment = input.download || item.preview === "none";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": contentDisposition(item.name, attachment),
    "Content-Type": item.mimeType ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (input.contentLength !== undefined) headers.set("Content-Length", String(input.contentLength));
  if (input.contentRange) headers.set("Content-Range", input.contentRange);
  if (input.etag) headers.set("ETag", input.etag);
  if (input.lastModified) headers.set("Last-Modified", input.lastModified.toUTCString());
  if (item.preview === "pdf" && !attachment) headers.set("Content-Security-Policy", "sandbox");
  return headers;
}

export async function GET(request: Request, context: RouteParams) {
  try {
    const item = await resolveFile(context);
    if (!item) return Response.json({ error: { code: "not_found", message: "File was not found." } }, { status: 404 });
    const range = request.headers.get("range");
    if (range && !isSatisfiableSingleRange(range, item.byteSize ?? 0)) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${item.byteSize ?? 0}`, "Cache-Control": "private, no-store" } });
    }
    const object = await getStoredObject(item.storageKey!, range);
    if (!object.Body) return new Response(null, { status: 502 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    const headers = headersFor(item, {
      contentLength: object.ContentLength, contentRange: object.ContentRange,
      etag: object.ETag, lastModified: object.LastModified, download,
    });
    return new Response(object.Body.transformToWebStream() as ReadableStream, { status: object.ContentRange ? 206 : 200, headers });
  } catch (error) { return accessErrorResponse(error); }
}

export async function HEAD(request: Request, context: RouteParams) {
  try {
    const item = await resolveFile(context);
    if (!item) return new Response(null, { status: 404 });
    const object = await headStoredObject(item.storageKey!);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(null, { headers: headersFor(item, { contentLength: object.ContentLength, etag: object.ETag, lastModified: object.LastModified, download }) });
  } catch (error) { return accessErrorResponse(error); }
}
