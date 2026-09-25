import { describe, expect, test } from "bun:test";

import { contentDisposition, isSatisfiableSingleRange } from "@/lib/http";

describe("file response headers", () => {
  test("accepts valid video ranges and rejects malformed or unsatisfiable ranges", () => {
    expect(isSatisfiableSingleRange("bytes=0-99", 1000)).toBe(true);
    expect(isSatisfiableSingleRange("bytes=100-", 1000)).toBe(true);
    expect(isSatisfiableSingleRange("bytes=-100", 1000)).toBe(true);
    expect(isSatisfiableSingleRange("bytes=1000-", 1000)).toBe(false);
    expect(isSatisfiableSingleRange("bytes=100-50", 1000)).toBe(false);
    expect(isSatisfiableSingleRange("bytes=0-1,4-5", 1000)).toBe(false);
  });

  test("creates a safe UTF-8 content disposition", () => {
    const value = contentDisposition("Šiška \"promo\".pdf", true);
    expect(value).toStartWith("attachment; filename=");
    expect(value).toContain("filename*=UTF-8''");
    expect(value).not.toContain('filename="_i_ka "promo"');
  });
});
