import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";
import type { Readable } from "node:stream";

const bucket = process.env.S3_BUCKET!;
export const MULTIPART_PART_SIZE = 64 * 1024 * 1024;
export const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

const globalForS3 = globalThis as unknown as { spyglassS3?: S3Client };
export const s3 = globalForS3.spyglassS3 ?? new S3Client({
  region: process.env.S3_REGION!,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  // Garage does not require the SDK's optional checksum headers.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
if (process.env.NODE_ENV !== "production") globalForS3.spyglassS3 = s3;

export async function createMultipartUpload(key: string, contentType: string) {
  const result = await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType || "application/octet-stream",
  }));
  if (!result.UploadId) throw new Error("S3 did not return a multipart upload ID.");
  return result.UploadId;
}

export async function uploadPart(key: string, uploadId: string, partNumber: number, body: Readable, byteSize: number) {
  const result = await s3.send(new UploadPartCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: body,
    ContentLength: byteSize,
  }));
  if (!result.ETag) throw new Error("S3 did not return a part ETag.");
  return result.ETag;
}

export async function listUploadedParts(key: string, uploadId: string) {
  const parts: Array<{ partNumber: number; etag: string; size: number }> = [];
  let marker: string | undefined;
  do {
    const result = await s3.send(new ListPartsCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumberMarker: marker,
    }));
    for (const part of result.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size ?? 0 });
      }
    }
    marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]) {
  return s3.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  }));
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
}

export async function inspectStoredObject(key: string) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const sample = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-16383" }));
  const bytes = sample.Body ? await sample.Body.transformToByteArray() : new Uint8Array();
  const detected = await fileTypeFromBuffer(bytes);
  // The multipart Content-Type came from the browser and is not authoritative.
  // Unknown signatures stay download-only instead of inheriting that declaration.
  const mimeType = detected?.mime ?? "application/octet-stream";
  const preview = classifyPreview(mimeType);
  return { byteSize: head.ContentLength ?? 0, etag: head.ETag ?? null, mimeType, preview };
}

export function classifyPreview(mimeType: string): "image" | "video" | "audio" | "pdf" | "none" {
  if (["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"].includes(mimeType)) return "image";
  if (["video/mp4", "video/webm", "video/ogg", "video/quicktime"].includes(mimeType)) return "video";
  if (["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/ogg", "audio/ogg; codecs=opus", "audio/webm", "audio/flac", "audio/x-flac"].includes(mimeType)) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "none";
}

export async function getStoredObject(key: string, range?: string | null) {
  return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range || undefined }));
}

export async function headStoredObject(key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteStoredObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
