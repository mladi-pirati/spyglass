import { describe, expect, test } from "bun:test";

import { limitPartBody, UploadPartSizeError } from "@/lib/upload-part-body";

function body(...chunks: number[][]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

async function read(stream: AsyncIterable<Uint8Array>) {
  const chunks: number[][] = [];
  for await (const chunk of stream) chunks.push([...chunk]);
  return chunks;
}

describe("upload part stream", () => {
  test("preserves the chunks of an exact-size part", async () => {
    expect(await read(limitPartBody(body([1, 2], [3]), 3))).toEqual([[1, 2], [3]]);
  });

  test("rejects a part that exceeds its expected size", async () => {
    expect(read(limitPartBody(body([1, 2], [3]), 2))).rejects.toBeInstanceOf(UploadPartSizeError);
  });

  test("rejects a truncated part", async () => {
    expect(read(limitPartBody(body([1, 2]), 3))).rejects.toBeInstanceOf(UploadPartSizeError);
  });
});
