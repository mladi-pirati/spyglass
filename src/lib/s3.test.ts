import { describe, expect, test } from "bun:test";

import { classifyPreview, MAX_FILE_SIZE, MULTIPART_PART_SIZE } from "@/lib/s3";

describe("S3 media policy", () => {
  test("uses the configured transfer limits", () => {
    expect(MULTIPART_PART_SIZE).toBe(64 * 1024 * 1024);
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024 * 1024);
  });

  test("previews only explicitly supported browser-native media", () => {
    expect(classifyPreview("image/jpeg")).toBe("image");
    expect(classifyPreview("video/mp4")).toBe("video");
    expect(classifyPreview("application/pdf")).toBe("pdf");
    expect(classifyPreview("image/svg+xml")).toBe("none");
    expect(classifyPreview("application/zip")).toBe("none");
  });
});
