export class UploadPartSizeError extends Error {}

export async function* limitPartBody(body: ReadableStream<Uint8Array>, expectedSize: number) {
  const reader = body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > expectedSize) throw new UploadPartSizeError("Upload part exceeded its declared size.");
      yield value;
    }
    if (received !== expectedSize) throw new UploadPartSizeError("Upload part ended before its declared size.");
  } finally {
    reader.releaseLock();
  }
}
